// Stamps (M3-14, §7.3, ADR-015 decision 1, M3-Q4): Dynamic Stamp draws the
// active scheme's code, the reviewer, the date and the document's number and
// revision into a PNG in the encoder worker (rule 1); Image Stamp places a
// PNG/JPG, or the first page of a PDF as a vector appearance. PDFium writes the
// appearance either way (B7). The text also goes to /Subj and /Contents.
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfAnnotationObject,
  type PdfStampAnnoObject,
} from '@embedpdf/models';
import type {
  AnnotationCapability,
  AnnotationTool,
  HandlerFactory,
} from '@embedpdf/plugin-annotation';
import { documentStore } from '../../app/store/documentStore';
import { recordError } from '../../app/diagnostics';
import { fontPath } from '../../engine/fonts';
import { format } from '../../i18n';
import { needsCjk, STAMP_SCALE, STAMP_SIZE, stampText } from '../../model/stamp';
import type { StatusCode } from '../../model/statusScheme';
import { t } from '../../i18n';
import { requestProfile } from '../settings/profile/profileStore';
import { currentAuthor } from '../annotate/authoring';
import { capability, hostStore, renderEngine } from '../view/host';
import { activeScheme, loadSchemes } from './schemes/schemeStore';
import { stampStore } from './stampStore';

interface Pos {
  x: number;
  y: number;
}

const labelOf = (c: StatusCode): string => (c.labelKey ? t(c.labelKey as never) : (c.label ?? ''));

/** The code the next dynamic stamp uses: the picked one, else the scheme's first. */
export function currentCode(): StatusCode | null {
  const scheme = activeScheme();
  const picked = stampStore.getState().code;
  return scheme.codes.find((c) => c.code === picked) ?? scheme.codes[0] ?? null;
}

function scope(docId: string) {
  const registry = hostStore.getState().registry;
  return registry
    ? capability<AnnotationCapability>(registry, 'annotation').forDocument(docId)
    : null;
}

function pageSize(docId: string, pageIndex: number): { width: number; height: number } | null {
  const registry = hostStore.getState().registry;
  const page = registry?.getStore().getState().core.documents[docId]?.document?.pages[pageIndex];
  return page ? page.size : null;
}

/** A rect of `size` centred on `pos`, kept on the page. */
function rectAt(
  pos: Pos,
  size: { width: number; height: number },
  page: { width: number; height: number },
) {
  const x = Math.min(Math.max(0, pos.x - size.width / 2), Math.max(0, page.width - size.width));
  const y = Math.min(Math.max(0, pos.y - size.height / 2), Math.max(0, page.height - size.height));
  return { origin: { x, y }, size: { ...size } };
}

export async function placeDynamicStamp(
  docId: string,
  pageIndex: number,
  pos?: Pos,
): Promise<string | null> {
  await requestProfile();
  await loadSchemes();
  const page = pageSize(docId, pageIndex);
  const code = currentCode();
  if (!page || !code) return null;
  const info = stampStore.getState().docInfo[docId] ?? { docNo: '', rev: '' };
  const text = stampText({
    code: code.code,
    label: labelOf(code),
    reviewer: currentAuthor(),
    date: format.date(new Date()),
    docNo: info.docNo,
    rev: info.rev,
  });
  const origin = location.origin;
  const all = text.lines.join(' ');
  let png: ArrayBuffer;
  try {
    png = await renderEngine().encoder.call('stamp', {
      lines: text.lines,
      color: code.color,
      width: STAMP_SIZE.width,
      height: STAMP_SIZE.height,
      scale: STAMP_SCALE,
      fontUrl: new URL(fontPath('latin'), origin).href,
      ...(needsCjk(all)
        ? { cjkFontUrl: new URL(fontPath(/[가-힯]/u.test(all) ? 'kr' : 'jp'), origin).href }
        : {}),
    }).promise;
  } catch (err) {
    recordError('stamp.draw', err);
    stampStore.setState({ problem: 'stamps.error.draw' });
    return null;
  }
  const id = uuidV4();
  const annot: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex,
    rect: rectAt(pos ?? { x: page.width / 2, y: page.height / 2 }, STAMP_SIZE, page),
    contents: text.contents,
    subject: text.subject,
    flags: ['print'],
    created: new Date(),
  };
  scope(docId)?.createAnnotation(pageIndex, annot, { data: png, mimeType: 'image/png' } as never);
  return id;
}

export async function placeImageStamp(
  docId: string,
  pageIndex: number,
  pos?: Pos,
): Promise<string | null> {
  const img = stampStore.getState().image;
  const page = pageSize(docId, pageIndex);
  if (!img || !page) return null;
  await requestProfile();
  const id = uuidV4();
  const annot = {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex,
    rect: rectAt(pos ?? { x: page.width / 2, y: page.height / 2 }, img, page),
    subject: img.name,
    contents: img.name,
    flags: ['print'],
    created: new Date(),
  } as PdfStampAnnoObject;
  // The data is copied: the same image can be placed again.
  scope(docId)?.createAnnotation(pageIndex, annot, {
    data: img.data.slice(0),
    mimeType: img.mimeType,
  });
  return id;
}

/** A click on the page places the stamp (the plugin's tool plumbing, our placement). */
function clickHandler(
  place: (docId: string, page: number, pos: Pos) => Promise<string | null>,
): HandlerFactory<PdfAnnotationObject> {
  return {
    annotationType: PdfAnnotationSubtype.STAMP,
    create(context) {
      return {
        onClick: (pos) => {
          const docId = documentStore.getState().activeId;
          if (docId) void place(docId, context.pageIndex, pos);
        },
      };
    },
  };
}

const tool = (id: string, place: Parameters<typeof clickHandler>[0]): AnnotationTool =>
  ({
    id,
    name: id,
    labelKey: `annotation.${id}`,
    categories: ['annotation', 'markup'],
    // Existing stamps keep EmbedPDF's own stamp tool for selection and resizing.
    matchScore: () => 0,
    interaction: {
      exclusive: false,
      cursor: 'copy',
      isDraggable: true,
      isResizable: true,
      lockAspectRatio: true,
    },
    defaults: { type: PdfAnnotationSubtype.STAMP },
    pointerHandler: clickHandler(place),
  }) as unknown as AnnotationTool;

/** Called once the plugin registry is up (DocumentHost). */
export function installStampTools(registry: PluginRegistry): void {
  try {
    const cap = capability<AnnotationCapability>(registry, 'annotation');
    cap.addTool(tool('dynamicStamp', placeDynamicStamp));
    cap.addTool(tool('imageStamp', placeImageStamp));
  } catch {
    // The annotation plugin is always registered (plugins.ts).
  }
}
