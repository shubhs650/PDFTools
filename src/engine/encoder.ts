// Image converter for EmbedPDF's PdfEngine that encodes in encoder.worker.ts
// (ADR-011 decision 4) instead of a main-thread canvas (rule 1).
import type { EncoderApi } from './encoderApi';
import type { ImageConverter } from './hostedEngine';
import { RpcClient } from './rpc';

export function createEncoder(): {
  converter: ImageConverter;
  client: RpcClient<EncoderApi>;
  worker: Worker;
} {
  const worker = new Worker(new URL('../workers/encoder.worker.ts', import.meta.url), {
    type: 'module',
    name: 'encoder',
  });
  const client = new RpcClient<EncoderApi>(worker, 'encoder');
  const converter = ((
    getImageData: () => { data: Uint8ClampedArray; width: number; height: number },
    imageType = 'image/png',
    quality?: number,
  ) => {
    const img = getImageData();
    // Pixels arrive by transfer from the Render worker, so we own the buffer and
    // can pass it on without a copy; otherwise copy once.
    const whole =
      img.data.byteOffset === 0 &&
      img.data.byteLength === img.data.buffer.byteLength &&
      img.data.buffer instanceof ArrayBuffer;
    const data = (
      whole ? img.data : new Uint8ClampedArray(img.data)
    ) as Uint8ClampedArray<ArrayBuffer>;
    return client.call(
      'encode',
      {
        data,
        width: img.width,
        height: img.height,
        type: imageType,
        ...(quality === undefined ? {} : { quality }),
      },
      { transfer: [data.buffer] },
    ).promise;
  }) as unknown as ImageConverter;
  return { converter, client, worker };
}
