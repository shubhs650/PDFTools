// Image stamps (M3-14): what a chosen file becomes. PNG and JPG are placed as
// images; a PDF's first page becomes a vector appearance — only when that PDF
// allows copying its content (rule 9) and opens without a password. Checked in
// the Render worker; the main thread reads only the file's header.
import { getImageMetadata, PdfErrorCode } from '@embedpdf/models';
import { allows } from '../../model/permissions';
import { fitWithin, IMAGE_STAMP_MAX, IMAGE_STAMP_MAX_BYTES } from '../../model/stamp';
import { renderEngine } from '../view/host';
import type { StampImage } from './stampStore';

export type ImageProblem = 'tooLarge' | 'unsupported' | 'pdfLocked' | 'pdfNoCopy' | 'pdfBroken';

export async function readStampImage(
  file: File,
): Promise<{ image: StampImage; problem: null } | { image: null; problem: ImageProblem }> {
  if (file.size > IMAGE_STAMP_MAX_BYTES) return { image: null, problem: 'tooLarge' };
  const data = await file.arrayBuffer();
  const meta = getImageMetadata(data);
  if (!meta) return { image: null, problem: 'unsupported' };
  const name = file.name;
  if (meta.mimeType !== 'application/pdf') {
    const size = fitWithin({ width: meta.width, height: meta.height }, IMAGE_STAMP_MAX);
    return { image: { data, mimeType: meta.mimeType, ...size, name }, problem: null };
  }
  const { engine } = renderEngine();
  let doc;
  try {
    doc = await engine
      .openDocumentBuffer({ id: `stamp-src-${String(Date.now())}`, content: data.slice(0) })
      .toPromise();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return { image: null, problem: code === PdfErrorCode.Password ? 'pdfLocked' : 'pdfBroken' };
  }
  try {
    const sec = { permissions: doc.permissions, revision: doc.isEncrypted ? 3 : -1 };
    if (!allows(sec, 'copy')) return { image: null, problem: 'pdfNoCopy' };
    const page = doc.pages[0];
    if (!page) return { image: null, problem: 'pdfBroken' };
    const size = fitWithin(page.size, IMAGE_STAMP_MAX);
    return { image: { data, mimeType: 'application/pdf', ...size, name }, problem: null };
  } finally {
    await engine
      .closeDocument(doc)
      .toPromise()
      .catch(() => undefined);
  }
}
