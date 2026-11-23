// Reopening a comparison file (M12-20, D-65, ADR-032): a PDF opened in a tab
// is checked for our tag (the Work worker reads its catalog, rule 1). A
// comparison file turns into its live comparison: Document A and B open from
// the copies inside (byte for byte), the comparison opens on its result with
// the saved pairing, placements, options, ignore zones, ticks and overlay
// notes, and the file's own tab closes. The comparison stays linked to the
// file: Save review writes it again (fileFlow). A file this version cannot
// use (newer, damaged, Document B changed by another program) stays open as
// the plain PDF it also is, with a notice.
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { t } from '../../../i18n';
import {
  DataError,
  VERSION,
  decodeData,
  type ComparisonData,
} from '../../../model/compare/file/format';
import { closeDocument, openFiles, type OpenedHook } from '../../open/openDocument';
import { showStatusToast } from '../../snapshot/snapshot';
import { workClient } from '../../view/host';
import { newComparisonId, type Comparison, type SideFile } from '../model';
import { seedNotes } from '../review/notes';
import { link } from './fileFlow';
import { restoreComparison } from './restore';

type Notice = 'newer' | 'broken' | 'missing' | 'changedB' | 'failed';

const NOTICE: Record<Notice, () => string> = {
  newer: () => t('compare.file.open.newer'),
  broken: () => t('compare.file.open.broken'),
  missing: () => t('compare.file.open.missing'),
  changedB: () => t('compare.file.open.changedB'),
  failed: () => t('compare.file.open.failed'),
};

const say = (docId: string, notice: Notice): void => {
  showStatusToast(docId, NOTICE[notice](), false);
};

/** In flight, so a file opened twice at once is taken apart once. */
const reading = new Set<string>();

/** The open pipeline's hook: a comparison file opened in a tab becomes its comparison. */
export const onOpened: OpenedHook = (docId, opened) => {
  if (reading.has(docId)) return;
  reading.add(docId);
  void reopen(docId, opened).finally(() => reading.delete(docId));
};

async function reopen(
  docId: string,
  opened: { file: File; handle?: FileSystemFileHandle; password?: string },
): Promise<void> {
  let probe;
  try {
    // The Work worker's copy is added just after the tab opens.
    if (!(await workClient().whenAdded(docId, 30_000))) return;
    probe = await workClient().run('compareFileProbe', { docId }).promise;
  } catch {
    return; // not readable as ours: it stays the PDF it is
  }
  if (!probe || !documentStore.getState().docs[docId]) return;
  if (probe.version > VERSION) {
    say(docId, 'newer');
    return;
  }
  let data: ComparisonData;
  let contents;
  try {
    contents = await workClient().run('compareFileRead', { docId }).promise;
    data = decodeData(new TextEncoder().encode(contents.data));
  } catch (err) {
    if (err instanceof DataError) say(docId, err.problem === 'newer' ? 'newer' : 'broken');
    else {
      recordError('compare.reopen', err);
      say(docId, 'failed');
    }
    return;
  }
  const { A, B } = contents;
  if (A.length !== data.documents.A.length || B.length !== data.documents.B.length) {
    say(docId, 'missing');
    return;
  }
  // Each copy must be the file that was saved; for text, B is the file itself.
  if (data.kind === 'text' && !B[0]?.exact) {
    say(docId, 'changedB');
    return;
  }
  if ([...A, ...B].some((r) => !r.exact)) {
    say(docId, 'broken');
    return;
  }
  const filesOf = (side: 'A' | 'B'): File[] =>
    contents[side].map(
      (r, i) =>
        new File([r.bytes], data.documents[side][i]?.name ?? '', { type: 'application/pdf' }),
    );
  const ids = await openFiles(
    [...filesOf('A'), ...filesOf('B')].map((file) => ({ file })),
    'attachment',
    {
      tab: false,
      inner: true,
      ...(opened.password === undefined ? {} : { password: opened.password }),
    },
  );
  const opened_ = ids.filter((x): x is string => x !== undefined);
  if (opened_.length !== ids.length || !documentStore.getState().docs[docId]) {
    // A copy did not open (a password not given): the file stays as it is.
    for (const d of opened_) void closeDocument(d);
    if (opened_.length !== ids.length) say(docId, 'failed');
    return;
  }
  const sideOf = (side: 'A' | 'B', from: number): SideFile[] =>
    data.documents[side].map((f, i) => ({ docId: opened_[from + i] ?? '', range: f.range }));
  const id = newComparisonId();
  const c: Comparison = {
    id,
    type: data.kind,
    stage: 'result',
    a: sideOf('A', 0),
    b: sideOf('B', A.length),
    ...(data.kind === 'overlay' && data.area
      ? { area: { a: [...data.area.a], b: [...data.area.b] } }
      : {}),
  };
  restoreComparison(c, data);
  if (contents.notes) seedNotes(id, contents.notes);
  link(id, {
    kind: data.kind,
    name: opened.file.name,
    ...(opened.handle ? { handle: opened.handle } : {}),
    data,
    docIds: opened_,
    foreignRevisions: contents.foreignRevisions,
    ...(opened.password === undefined ? {} : { password: opened.password }),
  });
  // The comparison takes the file's place among the tabs.
  const s = documentStore.getState();
  const at = s.order.indexOf(docId);
  s.openComparison(c, at >= 0 ? at : undefined);
  await closeDocument(docId);
  if (contents.foreignRevisions > 0)
    showStatusToast(opened_[0] ?? '', t('compare.file.open.foreign'), true);
}
