// Makes print-page PNGs off the main thread (a stand-in for the Work worker's
// print rasters, M2-15): a white page with a grid and some text-like bars.
self.onmessage = async (e: MessageEvent<{ n: number; w: number; h: number }>) => {
  const { n, w, h } = e.data;
  const blobs: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#000';
    for (let x = 0; x < w; x += 40) g.strokeRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 40) g.strokeRect(0, y, w, 1);
    g.fillStyle = '#000';
    g.font = `${String(Math.round(w / 20))}px sans-serif`;
    g.fillText(`Page ${String(i + 1)}`, w / 10, h / 10);
    blobs.push(await c.convertToBlob({ type: 'image/png' }));
  }
  self.postMessage(blobs);
};
