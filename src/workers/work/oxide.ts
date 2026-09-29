// PDF Oxide in the Work worker (M4-04, ADR-009 decisions 1–3 and 7): text,
// Markdown, HTML and image extraction for the exports (§7.6). One instance per
// Work worker, loaded lazily from a same-origin URL that is always passed
// explicitly (never the glue's own default), warmed up once in the background
// so its ~0.7 s first call never lands on a user action. Oxide ignores PDF
// permission flags, so every caller checks PDFium's first (rule 9,
// permissionGate.ts) and hands Oxide only documents PDFium has opened, with
// the same password.

/** The part of the `pdf-oxide-wasm` document API the exports use (0.3.x). */
export interface OxideDocument {
  pageCount(): number;
  toPlainText(page: number): string;
  toMarkdown(page: number, detectHeadings?: boolean, includeImages?: boolean): string;
  toHtml(page: number, preserveLayout?: boolean, detectHeadings?: boolean): string;
  extractImages(page: number): unknown;
  extractImageBytes(page: number): unknown;
  extractTextLines(page: number): unknown;
  extractWords(page: number): unknown;
  extractTables(page: number): unknown;
  authenticate(password: string): boolean;
  free(): void;
}

export interface OxideLibrary {
  open(bytes: Uint8Array, password?: string): OxideDocument;
  /** Bytes of Oxide's own WASM memory (the ADR-004 respawn policy counts it). */
  memoryBytes(): number;
}

export type OxideLoader = () => Promise<OxideLibrary>;

/** The browser loader: the web build's glue, lazily imported (its own chunk), with an explicit WASM URL. */
export function webLoader(wasmUrl: () => string): OxideLoader {
  return async () => {
    // The worker build resolves the package's "worker" condition: the web glue,
    // whose default export initializes the module (the typings describe the
    // bundler build, so the web shape is spelled out here).
    const lib = (await import('pdf-oxide-wasm')) as unknown as {
      default: (o: { module_or_path: string }) => Promise<{ memory: WebAssembly.Memory }>;
      WasmPdfDocument: new (data: Uint8Array, password?: string | null) => OxideDocument;
    };
    const out = await lib.default({ module_or_path: wasmUrl() });
    return {
      open: (bytes, password) => new lib.WasmPdfDocument(bytes, password ?? null),
      memoryBytes: () => out.memory.buffer.byteLength,
    };
  };
}

/**
 * Oxide returns JS Maps (and arrays of them); the rest of the app, and
 * structured clone into the main thread, want plain objects.
 */
export function toPlain(v: unknown): unknown {
  if (v instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of v as Map<unknown, unknown>) o[String(k)] = toPlain(x);
    return o;
  }
  if (Array.isArray(v)) return v.map(toPlain);
  if (ArrayBuffer.isView(v) || v === null || typeof v !== 'object') return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = toPlain(x);
  return o;
}

/** A one-page PDF with a line of text: the warm-up input (built here, no file needed). */
export function warmUpPdf(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 20 50 Td (Warm up) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

interface Held {
  /** What the document was opened from (a changed tail reopens it). */
  key: string;
  doc: OxideDocument;
}

export class OxideHost {
  private readonly loader: OxideLoader;
  private lib: Promise<OxideLibrary> | null = null;
  private ready: OxideLibrary | null = null;
  private readonly held = new Map<string, Held>();
  /** Milliseconds the warm-up took (null until it ran). */
  warmUpMs: number | null = null;
  private warming: Promise<number> | null = null;

  constructor(loader: OxideLoader) {
    this.loader = loader;
  }

  get loaded(): boolean {
    return this.lib !== null;
  }

  private library(): Promise<OxideLibrary> {
    this.lib ??= this.loader().then(
      (lib) => {
        this.ready = lib;
        return lib;
      },
      (err: unknown) => {
        this.lib = null; // a failed fetch (offline before precache) may succeed later
        throw err;
      },
    );
    return this.lib;
  }

  /**
   * ADR-009 decision 2: one throwaway extraction, so the first-call cost is
   * paid here. Idempotent; resolves with the time it took.
   */
  warmUp(): Promise<number> {
    this.warming ??= (async () => {
      const t0 = performance.now();
      const lib = await this.library();
      const doc = lib.open(warmUpPdf());
      try {
        doc.toPlainText(0);
        doc.toMarkdown(0, true, false);
      } finally {
        doc.free();
      }
      this.warmUpMs = performance.now() - t0;
      return this.warmUpMs;
    })().catch((err: unknown) => {
      this.warming = null;
      throw err;
    });
    return this.warming;
  }

  /**
   * The document as Oxide sees it, opened from `bytes` (the Work worker's
   * original + tail) and kept while `key` is unchanged. Callers have already
   * passed the permission gate.
   */
  async document(
    docId: string,
    key: string,
    bytes: () => Uint8Array,
    password?: string,
  ): Promise<OxideDocument> {
    const cur = this.held.get(docId);
    if (cur?.key === key) return cur.doc;
    this.drop(docId);
    await this.warmUp();
    const lib = await this.library();
    const doc = lib.open(bytes(), password);
    this.held.set(docId, { key, doc });
    return doc;
  }

  drop(docId: string): void {
    const cur = this.held.get(docId);
    if (!cur) return;
    this.held.delete(docId);
    cur.doc.free();
  }

  /** Oxide's own WASM memory once loaded (0 before), for the respawn policy (ADR-004 d4). */
  memoryBytes(): number {
    return this.ready?.memoryBytes() ?? 0;
  }
}
