// About → Built with (M10-01, ADR-027 D-48): the main components Triya PDF is
// made of. Versions and licenses come from the installed packages at build
// time (scripts/vite-assets.ts, `virtual:built-with`); the full list of every
// package and its license text is About's Open-source licenses view.
import { msg, type MessageKey } from '../../i18n/keys.ts';

export interface BuiltWithItem {
  /** The npm package whose version (and license, unless `license` is set) is shown. */
  pkg: string;
  name: MessageKey;
  role: MessageKey;
  /**
   * The component's own license where the package wraps it: PDFium's
   * LICENSE.pdfium (BSD-3-Clause with Apache-2.0 parts) inside @embedpdf/pdfium.
   */
  license?: string;
}

export const BUILT_WITH: readonly BuiltWithItem[] = [
  {
    pkg: '@embedpdf/core',
    name: msg('about.builtWith.embedpdf.name'),
    role: msg('about.builtWith.embedpdf.role'),
  },
  {
    pkg: '@embedpdf/pdfium',
    name: msg('about.builtWith.pdfium.name'),
    role: msg('about.builtWith.pdfium.role'),
    license: 'BSD-3-Clause, Apache-2.0',
  },
  {
    pkg: 'pdf-oxide-wasm',
    name: msg('about.builtWith.pdfOxide.name'),
    role: msg('about.builtWith.pdfOxide.role'),
  },
  {
    pkg: 'tesseract.js-core',
    name: msg('about.builtWith.tesseract.name'),
    role: msg('about.builtWith.tesseract.role'),
  },
  {
    pkg: '@fluentui/react-icons',
    name: msg('about.builtWith.fluentIcons.name'),
    role: msg('about.builtWith.fluentIcons.role'),
  },
  {
    pkg: '@embedpdf/fonts-latin',
    name: msg('about.builtWith.noto.name'),
    role: msg('about.builtWith.noto.role'),
  },
  {
    pkg: 'react',
    name: msg('about.builtWith.react.name'),
    role: msg('about.builtWith.react.role'),
  },
  {
    pkg: '@radix-ui/react-dialog',
    name: msg('about.builtWith.radix.name'),
    role: msg('about.builtWith.radix.role'),
  },
  {
    pkg: 'exceljs',
    name: msg('about.builtWith.exceljs.name'),
    role: msg('about.builtWith.exceljs.role'),
  },
  {
    pkg: 'docx',
    name: msg('about.builtWith.docx.name'),
    role: msg('about.builtWith.docx.role'),
  },
  {
    pkg: 'pkijs',
    name: msg('about.builtWith.pkijs.name'),
    role: msg('about.builtWith.pkijs.role'),
  },
  {
    pkg: 'i18next',
    name: msg('about.builtWith.i18next.name'),
    role: msg('about.builtWith.i18next.role'),
  },
];

export const BUILT_WITH_PACKAGES: readonly string[] = BUILT_WITH.map((c) => c.pkg);
