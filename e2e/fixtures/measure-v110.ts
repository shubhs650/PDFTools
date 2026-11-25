// A self-made page with measurements as Triya PDF 1.1.0 saved them (M14-03,
// Q38): a LineDimension Line and a PolygonDimension Polygon, each with its
// value in a FreeText grouped to it (/IRT, /RT /Group). Rule 13: generated.
import { buildPdf } from './generate.ts';

export function v110MeasurementsPdf(): Uint8Array {
  const red = '/C [0.894 0.259 0.204]';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 7 0 R 8 0 R 9 0 R] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 760 Td (Old measurements) Tj ET' },
    `<< /Type /Annot /Subtype /Line /NM (old-length) /Rect [96 496 304 504] /L [100 500 300 500] /IT /LineDimension /Cap true ${red} /BS << /W 1 >> /Contents (70.6 mm \\(uncalibrated\\)) /T (Ana de Vries) /F 4 >>`,
    '<< /Type /Annot /Subtype /FreeText /NM (old-length-label) /Rect [150 504 260 518] /Contents (70.6 mm \\(uncalibrated\\)) /DA (/Helv 10 Tf 0.894 0.259 0.204 rg) /IRT 6 0 R /RT /Group /T (Ana de Vries) /F 4 >>',
    `<< /Type /Annot /Subtype /Polygon /NM (old-area) /Rect [96 196 404 404] /Vertices [100 200 400 200 400 400 100 400] /IT /PolygonDimension ${red} /BS << /W 1 >> /Contents (7,056.7 mm² \\(uncalibrated\\)) /T (Ana de Vries) /F 4 >>`,
    '<< /Type /Annot /Subtype /FreeText /NM (old-area-label) /Rect [200 292 320 306] /Contents (7,056.7 mm² \\(uncalibrated\\)) /DA (/Helv 10 Tf 0.894 0.259 0.204 rg) /IRT 8 0 R /RT /Group /T (Ana de Vries) /F 4 >>',
  ]);
}
