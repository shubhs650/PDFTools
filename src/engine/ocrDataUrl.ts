// The absolute same-origin URLs of the OCR language data (rule 4): a separate
// module so the client can be unit-tested in Node without `location`.
import { ocrDataPath, type OcrLanguage } from '../model/ocr/languages';
import type { OcrDataSource } from './ocrApi';

export default function ocrDataSources(codes: readonly OcrLanguage[]): OcrDataSource[] {
  return codes.map((code) => ({
    code,
    url: new URL(`/${ocrDataPath(code)}`, location.origin).href,
  }));
}
