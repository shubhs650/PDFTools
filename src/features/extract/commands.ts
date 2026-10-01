// Convert → To Text / To Markdown / To HTML (M4-05), Export Images (M4-06) and
// To Word (Beta, M4-07),
// §7.6: open the export
// dialog for the active document. Extraction needs the copy permission (rule 9,
// ADR-009 decision 3); without it the commands are disabled with the reason.
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { openExport, type ExportFormat } from './exportJob';

const FORMATS: [string, ExportFormat][] = [
  ['convert.text', 'text'],
  ['convert.markdown', 'markdown'],
  ['convert.html', 'html'],
  ['convert.word', 'word'],
  ['convert.images', 'images'],
];

export function registerExtractCommands(): () => void {
  const offs = FORMATS.map(([id, format]) =>
    registerCommand(id, {
      requiresDocument: true,
      requires: 'copy',
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openExport(active.meta.id, format);
      },
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
