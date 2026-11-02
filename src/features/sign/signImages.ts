// The pictures of typed and uploaded signatures (M6-13): drawn and encoded in
// the encoder worker (rule 1), handed back as PNGs and kept base64 like the
// saved entries. The dialog shows the handwriting fonts too: they are loaded
// from our own origin with FontFace (ADR-022 decision 3; rule 4).
import {
  SIGNATURE_FONTS,
  signatureFontPath,
  type SignatureFont,
  type SignatureFontId,
} from '../../engine/fonts';
import { TYPED_FONT_PX, type ImageField } from '../../model/visualSignature';
import { renderEngine } from '../view/host';

export const fontById = (id: SignatureFontId): SignatureFont =>
  SIGNATURE_FONTS.find((f) => f.id === id) ?? SIGNATURE_FONTS[0];

const fontUrl = (f: SignatureFont): string => new URL(signatureFontPath(f), location.origin).href;

let fontsLoading: Promise<void> | null = null;

/** The handwriting fonts in the document's font set, for the dialog (once). */
export function loadSignatureFonts(): Promise<void> {
  fontsLoading ??= Promise.all(
    SIGNATURE_FONTS.map(async (f) => {
      const face = new FontFace(f.family, `url("${fontUrl(f)}")`);
      document.fonts.add(await face.load());
    }),
  )
    .then(() => undefined)
    .catch(() => {
      fontsLoading = null; // shown in the fallback font; drawing loads its own copy
    });
  return fontsLoading;
}

/** ArrayBuffer → base64, in chunks (a PNG of a signature is tens of KB). */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const pngDataUrl = (base64: string): string => `data:image/png;base64,${base64}`;

/** `text` in the font, cropped to the ink (null: nothing visible). */
export async function typedField(
  text: string,
  fontId: SignatureFontId,
  color: string,
): Promise<ImageField<string> | null> {
  const f = fontById(fontId);
  const r = await renderEngine().encoder.call('signatureText', {
    text,
    fontUrl: fontUrl(f),
    family: f.family,
    color,
    px: TYPED_FONT_PX,
  }).promise;
  if (!r) return null;
  return {
    creationType: 'type',
    label: text,
    previewDataUrl: '',
    imageMimeType: 'image/png',
    imageSize: { width: r.width, height: r.height },
    imageData: toBase64(r.png),
  };
}

/** An uploaded PNG/JPG, scaled, optionally cleared of its white background, cropped. */
export async function uploadedField(
  data: ArrayBuffer,
  transparent: boolean,
): Promise<ImageField<string> | null> {
  const r = await renderEngine().encoder.call('signatureImage', {
    data: data.slice(0),
    transparent,
  }).promise;
  if (!r) return null;
  return {
    creationType: 'upload',
    previewDataUrl: '',
    imageMimeType: 'image/png',
    imageSize: { width: r.width, height: r.height },
    imageData: toBase64(r.png),
  };
}
