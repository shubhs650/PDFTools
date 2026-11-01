/* eslint-disable */
// @ts-nocheck -- @embedpdf/plugin-signature and @embedpdf/default-signature-fonts are
// only installed for the spike run (npm install --no-save, see run-node.ts);
// M6-13 adds them for real.
//
// S20 — Visual signatures (ADR-021 D-40 b). @embedpdf/plugin-signature 2.15.1
// over EmbedPDF's PdfEngine and our tracked Render-worker executor: draw (ink),
// type (a PNG the type pad renders with a handwriting font: here Allura from
// @embedpdf/default-signature-fonts, rendered in Chromium through FontFace, as
// the pad does on a canvas) and upload (PNG with transparency) entries, placed
// with the plugin's own tool handlers. Checks: what lands in the file (Ink /
// Stamp, /AP, image + soft mask), Ctrl+S narrow + verification, qpdf, render,
// flatten on placement, the entries' serialized size (IndexedDB), the font
// package's license and size.
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { HistoryPluginPackage } from '@embedpdf/plugin-history';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import {
  SignatureCreationType,
  SignatureMode,
  SignaturePluginPackage,
  deserializeEntries,
  serializeEntries,
} from '@embedpdf/plugin-signature';
import { simplePdf } from '../../e2e/fixtures/generate.ts';
import { encodePng } from '../../src/workers/work/png.ts';
import { acquirePage } from '../../src/workers/render/pdfium.ts';
import { annotBoxes, renderAnnotTile } from '../s12-annotate/annot-tiles.ts';
import {
  closeDoc,
  ctrlS,
  engine,
  exec,
  installBrowserGlobals,
  mod,
  native,
  openPlain,
  qpdfCheck,
  qpdfJson,
  tick,
  tracker,
  work,
} from './harness.ts';

const require = createRequire(import.meta.url);

/** Typed signature: the pad's canvas step, in Chromium, with the OFL font from the package. */
async function typedPng(
  text: string,
): Promise<{ png: Uint8Array; width: number; height: number; fontBytes: number }> {
  const fontPath = require.resolve('@embedpdf/default-signature-fonts/fonts/Allura-Regular.ttf');
  const font = readFileSync(fontPath);
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
      : {},
  );
  try {
    const page = await browser.newPage();
    const r = await page.evaluate(
      async ({ b64, text }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const face = new FontFace('Allura', bytes);
        await face.load();
        document.fonts.add(face);
        const c = document.createElement('canvas');
        c.width = 600;
        c.height = 160;
        const g = c.getContext('2d');
        g.font = '96px Allura';
        g.fillStyle = '#1a1a80';
        g.textBaseline = 'middle';
        g.fillText(text, 20, 80);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (const x of buf) s += String.fromCharCode(x);
        return {
          png: btoa(s),
          width: c.width,
          height: c.height,
          check: document.fonts.check('96px Allura'),
        };
      },
      { b64: font.toString('base64'), text },
    );
    return {
      png: Uint8Array.from(Buffer.from(r.png, 'base64')),
      width: r.width,
      height: r.height,
      fontBytes: font.length,
      fontLoaded: r.check,
    } as never;
  } finally {
    await browser.close();
  }
}

/** Uploaded image: a 300 × 100 PNG with a transparent background and a dark scribble. */
async function uploadPng(): Promise<Uint8Array> {
  const w = 300;
  const h = 100;
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 10; x < 290; x++) {
    const y = Math.round(50 + 30 * Math.sin(x / 18));
    for (let dy = -2; dy <= 2; dy++) {
      const i = ((y + dy) * w + x) * 4;
      rgba[i] = 20;
      rgba[i + 1] = 20;
      rgba[i + 2] = 60;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(rgba, w, h);
}

async function makeRegistry() {
  installBrowserGlobals();
  Object.assign(globalThis, {
    URL: Object.assign(URL, { createObjectURL: () => 'blob:spike', revokeObjectURL: () => {} }),
  });
  const registry = new PluginRegistry(engine);
  registry.registerPlugin(DocumentManagerPluginPackage, { maxDocuments: 8 });
  registry.registerPlugin(ViewportPluginPackage, { viewportGap: 10 });
  registry.registerPlugin(ScrollPluginPackage, { defaultPageGap: 10 });
  registry.registerPlugin(InteractionManagerPluginPackage, {});
  registry.registerPlugin(SelectionPluginPackage, {});
  registry.registerPlugin(HistoryPluginPackage, {});
  registry.registerPlugin(AnnotationPluginPackage, { autoCommit: true, annotationAuthor: 'Spike' });
  registry.registerPlugin(SignaturePluginPackage, { mode: SignatureMode.SignatureAndInitials });
  await registry.initialize();
  return registry;
}

async function openInRegistry(registry, bytes, id) {
  const dm = registry.getPlugin('document-manager').provides();
  await dm
    .openDocumentBuffer({ buffer: bytes.slice().buffer, name: `${id}.pdf`, documentId: id })
    .toPromise();
  const store = registry.getStore();
  for (let i = 0; i < 60 && store.getState().core.documents[id]?.status !== 'loaded'; i++)
    await tick();
  await tick(3);
  await tracker.securityReady(id);
  await work.open(id, bytes.slice().buffer, undefined);
  return store.getState().core.documents[id].document;
}

/** Click once with the active signature tool (its own handler, its own tool context). */
async function place(registry, docId, at) {
  const annotation = registry.getPlugin('annotation');
  const cap = annotation.provides();
  const st = annotation.state;
  const activeId = st.documents[docId]?.activeToolId;
  const tool = cap.getTools().find((t) => t.id === activeId);
  if (!tool) throw new Error(`no active tool (${String(activeId)})`);
  const doc = registry.getStore().getState().core.documents[docId].document;
  const created = [];
  const handler = tool.pointerHandler.create({
    pageIndex: 0,
    pageSize: doc.pages[0].size,
    pageRotation: 0,
    scale: 1,
    services: {},
    onPreview: () => {},
    onCommit: (anno, ctx) => {
      created.push(anno);
      annotation.createAnnotation(0, anno, ctx, docId, {});
    },
    getTool: () => tool,
    getToolContext: () => annotation.state.documents[docId]?.activeToolContext,
  });
  handler.onPointerMove?.(at, {});
  handler.onPointerDown?.(at, { setPointerCapture() {}, releasePointerCapture() {} });
  await tick(8);
  return { tool: tool.id, annotation: created[0] };
}

function structure(bytes) {
  const j = qpdfJson(bytes);
  const objs = j.qpdf[1];
  const get = (ref) =>
    typeof ref === 'string' ? (objs[`obj:${ref}`]?.value ?? objs[`obj:${ref}`]?.stream?.dict) : ref;
  const out = [];
  for (const v of Object.values(objs)) {
    const d = v.value;
    if (!d || (d['/Subtype'] !== '/Stamp' && d['/Subtype'] !== '/Ink')) continue;
    const ap = get(get(d['/AP'])?.['/N']);
    const xobjs = ap ? get(get(ap['/Resources'])?.['/XObject']) : undefined;
    const images = xobjs
      ? Object.values(xobjs).map((r) => {
          const im = get(r);
          // Image XObjects may sit inside a nested form XObject.
          if (im?.['/Subtype'] === '/Form') {
            const inner = get(get(im['/Resources'])?.['/XObject']);
            return inner ? Object.values(inner).map((x) => pickImage(get(x))) : 'form';
          }
          return pickImage(im);
        })
      : undefined;
    out.push({
      Subtype: d['/Subtype'],
      Name: d['/Name'],
      Subj: d['/Subj'],
      T: d['/T'],
      F: d['/F'],
      IT: d['/IT'],
      hasAP: !!ap,
      apBBox: ap?.['/BBox'],
      images,
      rect: d['/Rect'],
      inkStrokes: Array.isArray(d['/InkList']) ? d['/InkList'].length : undefined,
    });
  }
  return out;
}
const pickImage = (im) =>
  im
    ? {
        w: im['/Width'],
        h: im['/Height'],
        bpc: im['/BitsPerComponent'],
        cs: im['/ColorSpace'],
        smask: !!im['/SMask'],
        filter: im['/Filter'],
      }
    : null;

async function pixelsOfAnnots(bytes) {
  const r = await openPlain(bytes);
  if ('error' in r) return r;
  const ref = acquirePage(native, r.doc.id, 0);
  const boxes = annotBoxes(mod, ref.pagePtr);
  ref.release();
  const out = boxes.map((b) => {
    const tile = renderAnnotTile(mod, native, r.doc.id, [b], 842, b.l - 2, 842 - b.t - 2, 1, 256);
    let n = 0;
    for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] > 0) n++;
    return n;
  });
  await native.closeDocument(r.doc).toPromise();
  return out;
}

export async function run() {
  const out = {};
  const typed = await typedPng('Ada Lovelace');
  const upload = await uploadPng();
  const registry = await makeRegistry();
  const sig = registry.getPlugin('signature').provides();

  const drawn = {
    creationType: SignatureCreationType.Draw,
    previewDataUrl: 'data:,',
    inkData: {
      inkList: [
        {
          points: Array.from({ length: 40 }, (_, i) => ({
            x: 10 + i * 7,
            y: 60 + 25 * Math.sin(i / 3),
          })),
        },
        { points: Array.from({ length: 20 }, (_, i) => ({ x: 40 + i * 9, y: 90 - i })) },
      ],
      strokeWidth: 3,
      strokeColor: '#000080',
      size: { width: 300, height: 120 },
    },
  };
  const ids = {
    draw: sig.addEntry({
      signature: drawn,
      initials: { ...drawn, inkData: { ...drawn.inkData, size: { width: 300, height: 120 } } },
    }),
    type: sig.addEntry({
      signature: {
        creationType: SignatureCreationType.Type,
        previewDataUrl: 'data:,',
        imageMimeType: 'image/png',
        imageSize: { width: typed.width, height: typed.height },
        imageData: typed.png.slice().buffer,
      },
    }),
    upload: sig.addEntry({
      signature: {
        creationType: SignatureCreationType.Upload,
        previewDataUrl: 'data:,',
        imageMimeType: 'image/png',
        imageSize: { width: 300, height: 100 },
        imageData: upload.slice().buffer,
      },
    }),
  };

  const src = simplePdf(1);
  const doc = await openInRegistry(registry, src, 'sig1');
  const placed = {};
  const y = { draw: 120, type: 220, upload: 320 };
  for (const k of ['draw', 'type', 'upload']) {
    sig.forDocument('sig1').activateSignaturePlacement(ids[k]);
    await tick(2);
    const p = await place(registry, 'sig1', { x: 200, y: y[k] });
    placed[k] = {
      tool: p.tool,
      type: PdfAnnotationSubtype[p.annotation?.type],
      size: p.annotation?.rect?.size,
    };
  }
  sig.forDocument('sig1').activateInitialsPlacement(ids.draw);
  await tick(2);
  const ini = await place(registry, 'sig1', { x: 420, y: 120 });
  placed.initials = {
    tool: ini.tool,
    type: PdfAnnotationSubtype[ini.annotation?.type],
    size: ini.annotation?.rect?.size,
  };
  out.placed = placed;

  const saved = await ctrlS(doc, src);
  out.save = { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes };
  out.qpdfCheck = qpdfCheck(saved.bytes);
  out.structure = structure(saved.bytes);
  out.renderedPixels = await pixelsOfAnnots(saved.bytes);
  out.typed = {
    pngBytes: typed.png.length,
    fontBytes: typed.fontBytes,
    fontLoaded: typed.fontLoaded,
  };

  // Flatten on placement: the engine's flattenAnnotation (Render worker), then Ctrl+S.
  {
    const annots = await native.getPageAnnotations(doc, doc.pages[0]).toPromise();
    const stamp = annots.find((a) => a.type === PdfAnnotationSubtype.STAMP);
    let flattened;
    try {
      flattened = await exec('flattenAnnotation', doc, doc.pages[0], stamp);
    } catch (e) {
      flattened = `threw: ${e.message}`;
    }
    const s2 = await ctrlS(doc, saved.bytes);
    const r = await openPlain(s2.bytes);
    const left =
      'doc' in r
        ? (await native.getPageAnnotations(r.doc, r.doc.pages[0]).toPromise()).map(
            (a) => PdfAnnotationSubtype[a.type],
          )
        : r;
    let pageObjects;
    if ('doc' in r) {
      const ref = acquirePage(native, r.doc.id, 0);
      pageObjects = mod.FPDFPage_CountObjects(ref.pagePtr);
      ref.release();
      await native.closeDocument(r.doc).toPromise();
    }
    out.flatten = {
      result: flattened,
      save: { mode: s2.mode, fellBack: s2.fellBack, tailBytes: s2.tailBytes },
      annotationsLeft: left,
      pageObjectsAfter: pageObjects,
      qpdfCheck: qpdfCheck(s2.bytes),
    };
  }
  await closeDoc(doc);

  // Saved signatures on this device: serialized size (IndexedDB) and round trip.
  const ser = serializeEntries(sig.getEntries());
  const json = JSON.stringify(ser);
  const back = deserializeEntries(JSON.parse(json));
  out.storage = {
    entries: ser.length,
    jsonBytes: json.length,
    roundTrip:
      back.length === ser.length &&
      back.every((e, i) => e.signature.creationType === ser[i].signature.creationType),
  };

  const fontsPkg = require('@embedpdf/default-signature-fonts/package.json');
  const fontsDir = require
    .resolve('@embedpdf/default-signature-fonts/fonts/Allura-Regular.ttf')
    .replace(/Allura-Regular\.ttf$/, '');
  out.fontsPackage = {
    version: fontsPkg.version,
    license: fontsPkg.license,
    files: ['Allura-Regular.ttf', 'GreatVibes-Regular.ttf', 'Caveat-Regular.ttf'].map(
      (f) => `${f} ${String(statSync(fontsDir + f).size)} B`,
    ),
  };
  return out;
}
