// The absolute same-origin URL of the OCR language data (rule 4): a separate
// module so the client can be unit-tested in Node without `location`.
import { OCR_DATA_PATH } from './ocrApi';

export default function ocrDataUrl(): string {
  return new URL(`/${OCR_DATA_PATH}`, location.origin).href;
}
