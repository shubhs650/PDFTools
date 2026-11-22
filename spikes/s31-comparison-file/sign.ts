// Spike S31 (M12-06): signs a copy of a corpus file for the signed-input
// cases — an approval signature, or a certification (DocMDP) with a given
// permission level — in an incremental revision written by our object layer,
// with a throwaway key generated per run (e2e/fixtures/signed.ts). Nothing
// signed is committed (rule 13: the corpus files are self-made).
import {
  N,
  PdfRef,
  PdfString,
  isDict,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { CONTENTS_HEX, PLACEHOLDER, fill, type Signer } from '../../e2e/fixtures/signed';
import { Section } from './section';

/** `docMdp`: 1 = no changes, 2 = form filling and signing, 3 = also comments. Absent = approval. */
export async function signCopy(
  bytes: Uint8Array,
  signer: Signer,
  opts: { docMdp?: 1 | 2 | 3 } = {},
): Promise<Uint8Array> {
  const sec = await Section.open(bytes);
  const cat = await sec.catalog();
  const pages = await sec.reader.pages();
  const page = pages[0];
  if (!page) throw new Error('no page');
  const widget = sec.alloc();
  const sig = sec.alloc();
  const ref = opts.docMdp
    ? ` /Reference [<< /Type /SigRef /TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P ${String(opts.docMdp)} /V /1.2 >> >>]`
    : '';
  sec.raw(
    sig,
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${PLACEHOLDER} /Contents <${'0'.repeat(CONTENTS_HEX)}> /M (D:20261101120000Z) /Name (Spike Signer) /Reason (${opts.docMdp ? 'Certified' : 'Approved'}) /Location (Spike S31)${ref} >>`,
  );
  sec.value(
    widget,
    new Map<string, PdfValue>([
      ['Type', N('Annot')],
      ['Subtype', N('Widget')],
      ['FT', N('Sig')],
      ['T', PdfString.of(opts.docMdp ? 'Certification' : 'Approval')],
      ['Rect', [0, 0, 0, 0]],
      ['F', 132],
      ['P', new PdfRef(page.num, 0)],
      ['V', new PdfRef(sig, 0)],
    ]),
  );
  const pd: PdfDict = new Map(page.dict);
  const annots = await sec.reader.resolve(pd.get('Annots'));
  pd.set('Annots', [...(Array.isArray(annots) ? annots : []), new PdfRef(widget, 0)]);
  sec.value(page.num, pd);
  const cd: PdfDict = new Map(cat.dict);
  const form = await sec.reader.resolve(cd.get('AcroForm'));
  const fd: PdfDict = new Map(isDict(form) ? form : []);
  const fields = await sec.reader.resolve(fd.get('Fields'));
  fd.set('Fields', [...(Array.isArray(fields) ? fields : []), new PdfRef(widget, 0)]);
  fd.set('SigFlags', 3);
  cd.set('AcroForm', fd);
  if (opts.docMdp) cd.set('Perms', new Map<string, PdfValue>([['DocMDP', new PdfRef(sig, 0)]]));
  sec.value(cat.num, cd);
  return fill(sec.finish(), signer, new Date(Date.UTC(2026, 10, 1, 12)));
}

/** The DocMDP level of a file (`/Perms /DocMDP`), or null when it is not certified. */
export async function docMdpOf(sec: Section): Promise<number | null> {
  const cat = await sec.catalog();
  const perms = await sec.reader.resolve(cat.dict.get('Perms'));
  if (!isDict(perms)) return null;
  const sig = await sec.reader.resolve(perms.get('DocMDP'));
  if (!isDict(sig)) return null;
  const refs = await sec.reader.resolve(sig.get('Reference'));
  for (const r of Array.isArray(refs) ? refs : []) {
    const d = await sec.reader.resolve(r);
    if (!isDict(d)) continue;
    const tp = await sec.reader.resolve(d.get('TransformParams'));
    const p = isDict(tp) ? tp.get('P') : undefined;
    return typeof p === 'number' ? p : 2;
  }
  return 2;
}
