// Fonts installed on this computer, in the Render worker (M11-08·O5, D-54).
// Local Font Access exists only on the main thread, so the worker asks it for
// a face's file over a MessagePort (`{ id, file }` → `{ id, blob }`); the
// bytes never leave the device and are never stored. A face is used only
// when its embedding flags allow it and it has TrueType outlines (sfnt.ts);
// a face of a collection is cut out of it first.
import { SYSTEM_FONT_PREFIX } from '../../../model/fonts/library';
import {
  extractFace,
  inspectFont,
  type FontInspection,
  type Reader,
} from '../../../model/fonts/sfnt';

/** Worker → main: the file of the face whose file id (`sys:<PostScript name>`) is `file`. */
export interface SystemFontRequest {
  id: number;
  file: string;
}

/** Main → worker: the face's file, or nothing when the computer has no such face now. */
export interface SystemFontReply {
  id: number;
  blob: Blob | null;
}

interface Port {
  postMessage(message: SystemFontRequest): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<SystemFontReply>) => void): void;
  start?(): void;
}

export class SystemFontFiles {
  private port: Port | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (blob: Blob | null) => void>();
  private readonly inspected = new Map<string, Promise<FontInspection>>();

  /** The main thread's end of the channel (once). */
  connect(port: Port): void {
    if (this.port) return;
    this.port = port;
    port.addEventListener('message', (ev) => {
      const { id, blob } = ev.data;
      const resolve = this.waiting.get(id);
      this.waiting.delete(id);
      resolve?.(blob instanceof Blob ? blob : null);
    });
    port.start?.();
  }

  private request(file: string): Promise<Blob | null> {
    const port = this.port;
    if (!port) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      port.postMessage({ id, file });
    });
  }

  private static reader(blob: Blob): Reader {
    return async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  }

  /** What the face allows, read from its table directory and a few small tables (cached). */
  inspect(file: string): Promise<FontInspection> {
    let p = this.inspected.get(file);
    if (!p) {
      const ps = file.slice(SYSTEM_FONT_PREFIX.length);
      p = this.request(file).then((blob) =>
        blob
          ? inspectFont(SystemFontFiles.reader(blob), ps)
          : {
              index: 0,
              collection: false,
              postscriptName: ps,
              use: 'unreadable' as const,
              standard: 'helvetica' as const,
              variable: false,
            },
      );
      this.inspected.set(file, p);
    }
    return p;
  }

  /** The face's bytes, a font file of its own; throws when it cannot be used. */
  async bytes(file: string): Promise<Uint8Array> {
    const blob = await this.request(file);
    if (!blob) throw new Error('system font: not available');
    const ps = file.slice(SYSTEM_FONT_PREFIX.length);
    const info = await inspectFont(SystemFontFiles.reader(blob), ps);
    if (info.use !== 'ok') throw new Error(`system font: ${info.use}`);
    const all = new Uint8Array(await blob.arrayBuffer());
    return info.collection ? extractFace(all, info.index) : all;
  }
}
