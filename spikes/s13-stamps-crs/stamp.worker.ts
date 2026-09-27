// M3-02: a dynamic stamp drawn off the main thread (rule 1) into a PNG with the
// self-hosted Regular Noto Sans (ADR-003), for EmbedPDF's image stamp (ADR-001
// B7: PDFium writes the appearance). Canvas text, no appearance code of ours.
import fontUrl from '../../node_modules/@embedpdf/fonts-latin/fonts/NotoSans-Regular.ttf?url';

export interface StampSpec {
  code: string;
  label: string;
  reviewer: string;
  date: string;
  doc: string;
  /** Placed size in points; the bitmap is `scale` px per point. */
  width: number;
  height: number;
  scale: number;
  color: string;
}

let fontReady: Promise<void> | null = null;
function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    const face = new FontFace('StampSans', await (await fetch(fontUrl)).arrayBuffer());
    await face.load();
    (self as unknown as { fonts: FontFaceSet }).fonts.add(face);
  })();
  return fontReady;
}

async function draw(s: StampSpec): Promise<{ png: ArrayBuffer; ms: number; w: number; h: number }> {
  const t0 = performance.now();
  await loadFont();
  const w = Math.round(s.width * s.scale);
  const h = Math.round(s.height * s.scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const k = s.scale;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 2.5 * k;
  const r = 6 * k;
  ctx.beginPath();
  ctx.roundRect(1.5 * k, 1.5 * k, w - 3 * k, h - 3 * k, r);
  ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  // Code + label, largest line; then reviewer · date and document · revision.
  ctx.font = `${String(18 * k)}px StampSans`;
  ctx.fillText(`${s.code}  ${s.label}`, 10 * k, 24 * k, w - 20 * k);
  ctx.font = `${String(10 * k)}px StampSans`;
  ctx.fillText(`${s.reviewer} · ${s.date}`, 10 * k, 40 * k, w - 20 * k);
  ctx.fillText(s.doc, 10 * k, 53 * k, w - 20 * k);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { png: await blob.arrayBuffer(), ms: performance.now() - t0, w, h };
}

self.onmessage = async (e: MessageEvent<StampSpec>) => {
  try {
    const r = await draw(e.data);
    self.postMessage(r, { transfer: [r.png] });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
