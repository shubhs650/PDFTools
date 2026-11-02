// OCR languages (ADR-020 decision 2, amended by the owner on 2026-10-03): the
// five most spoken languages. Each is one tessdata_best integer model from
// npm (@tesseract.js-data/<code>, MIT; data Apache-2.0), self-hosted under
// /ocr/. English is precached in the background; the others are fetched on
// first use and kept by the service worker (sw.ts), so the install stays
// within the §9 budget.

export type OcrLanguage = 'eng' | 'chi_sim' | 'hin' | 'spa' | 'fra';

export interface OcrLanguageInfo {
  code: OcrLanguage;
  /** Compressed size on the wire, for the dialog's download note. */
  gzBytes: number;
}

/** In the order the dialog lists them. */
export const OCR_LANGUAGES: readonly OcrLanguageInfo[] = [
  { code: 'eng', gzBytes: 2_952_873 },
  { code: 'chi_sim', gzBytes: 1_718_768 },
  { code: 'hin', gzBytes: 1_389_692 },
  { code: 'spa', gzBytes: 2_100_190 },
  { code: 'fra', gzBytes: 707_406 },
];

/** Languages whose data is precached with the app (the rest: on first use). */
export const OCR_PRECACHED: readonly OcrLanguage[] = ['eng'];

export const isOcrLanguage = (s: string): s is OcrLanguage =>
  OCR_LANGUAGES.some((l) => l.code === s);

/** The self-hosted data file of a language, relative to the app root. */
export const ocrDataPath = (code: OcrLanguage): string => `ocr/${code}.traineddata.gz`;

/** Tesseract's language string: "eng+hin". */
export const ocrLanguageString = (codes: readonly OcrLanguage[]): string => codes.join('+');
