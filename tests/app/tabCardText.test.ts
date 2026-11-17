import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n';
import { createFormatters } from '../../src/i18n/format';
import { tabCardText, tabStatus } from '../../src/app/tabCardText';
import {
  createDocumentStore,
  DEFAULT_VIEW,
  type DocumentMeta,
  type DocumentSlice,
} from '../../src/app/store/documentStore';
import { fileFacts } from '../../src/features/open/openDocument';
import { PERM_PRINT } from '../../src/model/permissions';

// M11-03 (ADR-028 D-50): what a file tab's hover card and accessible description say.

const format = createFormatters('en-GB');
const MODIFIED = Date.UTC(2026, 10, 12, 10, 42);

function slice(meta: Partial<DocumentMeta> = {}, dirty = false): DocumentSlice {
  return {
    meta: {
      id: 'd',
      name: 'ASTM-C133_cold-crushing-strength_test-report_rev3.pdf',
      pageCount: 2,
      permissions: 0xffffffff,
      signatureCount: 0,
      ...meta,
    },
    view: { ...DEFAULT_VIEW },
    dirty,
    edits: dirty ? 1 : 0,
    save: 'idle',
    appendedBytes: 0,
  };
}

describe('tab hover card text', () => {
  it('a file from this device: full name, source, pages, size and modified time', () => {
    const c = tabCardText(
      slice({ source: 'picked', fileSize: 1_433_600, modified: MODIFIED }),
      t,
      format,
    );
    expect(c.name).toBe('ASTM-C133_cold-crushing-strength_test-report_rev3.pdf');
    expect(c.source).toBe('Opened from this device');
    expect(c.details).toBe(
      `2 pages · ${format.bytes(1_433_600)} · modified ${format.dateTime(MODIFIED)}`,
    );
    expect(c.status).toEqual([]);
    expect(c.description).toBe(`Opened from this device. ${c.details}`);
  });

  it('a document without a source reads as opened from this device', () => {
    expect(tabCardText(slice(), t, format).source).toBe('Opened from this device');
  });

  it('every source has its own line; no folder path is ever shown', () => {
    const lines = (
      [
        'picked',
        'dropped',
        'launched',
        'recent',
        'recovered',
        'attachment',
        'created',
        'saved',
        'downloaded',
      ] as const
    ).map((source) => tabCardText(slice({ source }), t, format).source);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toContain('Dropped onto Triya PDF');
    expect(lines).toContain('New document, not saved yet');
    expect(lines).toContain('Recovered after a crash');
    for (const l of lines) expect(l).not.toMatch(/[\\/]/);
  });

  it('a new document has no size or time, and one page reads "1 page"', () => {
    const c = tabCardText(slice({ source: 'created', pageCount: 1 }), t, format);
    expect(c.details).toBe('1 page');
  });

  it('status chips: unsaved first, then protected, restricted and signed', () => {
    const d = slice({ securityRevision: 4, permissions: PERM_PRINT, signatureCount: 1 }, true);
    expect(tabStatus(d)).toEqual(['unsaved', 'protected', 'restricted', 'signed']);
    const c = tabCardText(d, t, format);
    expect(c.status.map((s) => s.label)).toEqual([
      'Unsaved changes',
      'Password protected',
      'Restricted',
      'Signed',
    ]);
    expect(c.description).toMatch(/Unsaved changes\. Password protected\. Restricted\. Signed$/);
  });

  it('an open password without restrictions is protected, not restricted', () => {
    expect(tabStatus(slice({ securityRevision: 4 }))).toEqual(['protected']);
  });

  it('an owner unlock lifts "restricted"', () => {
    expect(
      tabStatus(slice({ securityRevision: 4, permissions: 0xffffffff, ownerUnlocked: true })),
    ).toEqual(['protected']);
  });
});

describe('file facts at open and after a save', () => {
  const file = new File([new Uint8Array(1234)], 'a.pdf', { lastModified: MODIFIED });

  it('a file on disk keeps its size and time; a built one only its source', () => {
    for (const source of [
      'picked',
      'dropped',
      'launched',
      'recent',
      'saved',
      'downloaded',
    ] as const)
      expect(fileFacts(file, source)).toEqual({ source, fileSize: 1234, modified: MODIFIED });
    for (const source of ['created', 'attachment', 'recovered'] as const)
      expect(fileFacts(file, source)).toEqual({ source });
  });

  it('setFileFacts updates the source, size and time, and nothing else', () => {
    const store = createDocumentStore();
    store.getState().open({ ...slice().meta, ...fileFacts(file, 'created') });
    store.getState().setFileFacts('d', { source: 'saved', fileSize: 99, modified: 5 });
    const { meta } = store.getState().docs.d ?? slice();
    expect(meta).toMatchObject({ source: 'saved', fileSize: 99, modified: 5, pageCount: 2 });
  });
});
