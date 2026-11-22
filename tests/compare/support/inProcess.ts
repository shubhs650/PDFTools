// In-process stand-ins for the comparison's workers in unit tests (M12-07,
// M12-10): the Compare worker's real handlers served on a MessageChannel, and
// a Work client whose compare jobs run the Work worker's own material code on
// real PDFium documents opened in the test.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { CompareApi } from '../../../src/engine/compareApi';
import { AbortError } from '../../../src/engine/errors';
import type { ArgsOf, ResultOf } from '../../../src/engine/protocol';
import type { WorkApi } from '../../../src/engine/workApi';
import type { WorkClient } from '../../../src/engine/workClient';
import { compareHandlers } from '../../../src/workers/compare/handlers';
import { CompareStore } from '../../../src/workers/compare/store';
import { acquirePage, docPtrOf } from '../../../src/workers/render/pdfium';
import { serve } from '../../../src/workers/rpc-host';
import {
  analysisBand,
  displayedSegments,
  frameOf,
  plainFrame,
  signatureOf,
  textOf,
} from '../../../src/workers/work/compareMaterial';
import { extractGeometry } from '../../../src/workers/work/geometry';

export interface FakeWorkers {
  spawned: number;
  terminated: number;
}

/** Spawns Compare "workers" on MessageChannels; their ports go into `ports` for closing. */
export function compareSpawn(w: FakeWorkers, ports: MessagePort[]) {
  return (): Worker => {
    w.spawned++;
    const ch = new MessageChannel();
    ports.push(ch.port1, ch.port2);
    serve<CompareApi>(ch.port1, compareHandlers(new CompareStore()));
    const port = ch.port2 as unknown as Worker & { terminate(): void };
    port.terminate = () => {
      w.terminated++;
      ch.port1.close();
      ch.port2.close();
    };
    return port;
  };
}

type Run = WorkClient['run'];

/** A Work client running the compare jobs in-process; `log` collects the methods called. */
export function fakeWork(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  log: string[],
): Pick<WorkClient, 'run' | 'hold'> & { held: number } {
  const page = <T>(docId: string, index: number, fn: (p: number) => T): T => {
    const ref = acquirePage(native, docId, index);
    try {
      return fn(ref.pagePtr);
    } finally {
      ref.release();
    }
  };
  const impl = {
    compareSignature: ({ docId, pageIndex }: ArgsOf<WorkApi, 'compareSignature'>) =>
      page(docId, pageIndex, (p) => signatureOf(mod, docPtrOf(native, docId), pageIndex, p)),
    compareGeometry: async ({ docId, pageIndex }: ArgsOf<WorkApi, 'compareGeometry'>) => {
      const ptr = docPtrOf(native, docId);
      const { segs } = await extractGeometry(mod, ptr, pageIndex, null);
      const frame = page(docId, pageIndex, (p) => plainFrame(frameOf(mod, ptr, pageIndex, p)));
      return { frame, segments: displayedSegments(segs, frame.toDisplay) };
    },
    compareText: ({ docId, pageIndex }: ArgsOf<WorkApi, 'compareText'>) =>
      page(docId, pageIndex, (p) =>
        textOf(mod, p, plainFrame(frameOf(mod, docPtrOf(native, docId), pageIndex, p))),
      ),
    compareRaster: ({ docId, pageIndex, ...req }: ArgsOf<WorkApi, 'compareRaster'>) =>
      page(docId, pageIndex, (p) =>
        analysisBand(mod, p, frameOf(mod, docPtrOf(native, docId), pageIndex, p).turn, req, () =>
          Promise.resolve(),
        ),
      ),
  };
  const fake = {
    held: 0,
    hold: () => {
      fake.held++;
      return () => {
        fake.held--;
      };
    },
    run: ((method: keyof typeof impl, args: never, options: { signal?: AbortSignal } = {}) => {
      log.push(method);
      const promise = (async () => {
        await new Promise((r) => setTimeout(r, 0));
        if (options.signal?.aborted) throw new AbortError();
        return (impl[method] as (a: never) => unknown)(args);
      })();
      return {
        promise: promise as Promise<ResultOf<WorkApi, typeof method>>,
        cancel: () => undefined,
      };
    }) as unknown as Run,
  };
  return fake;
}
