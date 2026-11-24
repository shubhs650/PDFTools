// The words of each sample comparison (M13-01, D-67, ADR-034): shared by the
// Compare input window's sample menu and the start screen's "Try comparing two
// revisions" (M13-01·O5).
import { msg, type MessageKey } from '../../i18n';
import type { Sample, SampleId, SampleSide } from '../../model/compare/samples';

/** The words of each sample comparison (M13-01, D-67). */
export const SAMPLE_TEXT: Record<
  SampleId,
  {
    title: MessageKey;
    description: MessageKey;
    lookFor: MessageKey;
    file: Record<SampleSide, MessageKey>;
  }
> = {
  flange: {
    title: msg('compare.sample.flange.title'),
    description: msg('compare.sample.flange.description'),
    lookFor: msg('compare.sample.flange.lookFor'),
    file: { a: msg('compare.sample.flange.fileA'), b: msg('compare.sample.flange.fileB') },
  },
  checkedPrint: {
    title: msg('compare.sample.checkedPrint.title'),
    description: msg('compare.sample.checkedPrint.description'),
    lookFor: msg('compare.sample.checkedPrint.lookFor'),
    file: {
      a: msg('compare.sample.checkedPrint.fileA'),
      b: msg('compare.sample.checkedPrint.fileB'),
    },
  },
  tender: {
    title: msg('compare.sample.tender.title'),
    description: msg('compare.sample.tender.description'),
    lookFor: msg('compare.sample.tender.lookFor'),
    file: { a: msg('compare.sample.tender.fileA'), b: msg('compare.sample.tender.fileB') },
  },
  invoice: {
    title: msg('compare.sample.invoice.title'),
    description: msg('compare.sample.invoice.description'),
    lookFor: msg('compare.sample.invoice.lookFor'),
    file: { a: msg('compare.sample.invoice.fileA'), b: msg('compare.sample.invoice.fileB') },
  },
};

/** What a sample's file is called in the app (Document A or B), translated by `t`. */
export const sampleFileName =
  (t: (key: MessageKey) => string) =>
  (sample: Sample, side: SampleSide): string =>
    t(SAMPLE_TEXT[sample.id].file[side]);
