// Image encoder worker for the spike: RGBA → Blob with OffscreenCanvas, so the
// main thread never touches a canvas for tiles (rule 1). Mirrors the shape of
// EmbedPDF's worker-pool converter input.
interface EncodeIn {
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  type: string;
  quality?: number;
}

self.addEventListener('message', (ev: MessageEvent<EncodeIn>) => {
  const { id, data, width, height, type, quality } = ev.data;
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.putImageData(new ImageData(data, width, height), 0, 0);
      const blob = await canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
      (self as unknown as Worker).postMessage({ id, blob });
    } catch (e) {
      (self as unknown as Worker).postMessage({ id, error: String(e) });
    }
  })();
});
