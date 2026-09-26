import { PdfErrorCode } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { transferablesFor } from '../../src/engine/hostedEngine';
import {
  OPEN_ERROR_MESSAGE,
  OpenError,
  classifyOpenError,
  hasPdfHeader,
} from '../../src/features/open/errors';
import {
  INITIAL,
  isFinal,
  transition,
  type OpenEvent,
  type OpenPhase,
} from '../../src/features/open/openMachine';
import { findDuplicate, type Candidate } from '../../src/features/open/sources';
import en from '../../src/i18n/en.json';

const enc = new TextEncoder();

describe('open state machine (M1-13)', () => {
  it('reading → opening → ready', () => {
    let s: OpenPhase = INITIAL;
    s = transition(s, { type: 'read' });
    expect(s).toEqual({ phase: 'opening' });
    s = transition(s, { type: 'opened', docId: 'd1' });
    expect(s).toEqual({ phase: 'ready', docId: 'd1' });
  });

  it('a duplicate ends while reading', () => {
    expect(transition(INITIAL, { type: 'duplicate', docId: 'd0' })).toEqual({
      phase: 'duplicate',
      docId: 'd0',
    });
  });

  it('fails from any non-final phase', () => {
    expect(transition(INITIAL, { type: 'failed', kind: 'not-pdf' })).toEqual({
      phase: 'error',
      kind: 'not-pdf',
    });
    expect(transition({ phase: 'opening' }, { type: 'failed', kind: 'damaged' })).toEqual({
      phase: 'error',
      kind: 'damaged',
    });
  });

  it('ignores out-of-order events and never leaves a final state', () => {
    expect(transition(INITIAL, { type: 'opened', docId: 'x' })).toBe(INITIAL);
    const opening: OpenPhase = { phase: 'opening' };
    expect(transition(opening, { type: 'duplicate', docId: 'x' })).toBe(opening);
    const ready: OpenPhase = { phase: 'ready', docId: 'a' };
    expect(transition(ready, { type: 'failed', kind: 'unknown' })).toBe(ready);
    const failed: OpenPhase = { phase: 'error', kind: 'damaged' };
    expect(transition(failed, { type: 'read' })).toBe(failed);
  });
});

describe('open state machine: passwords (M2-03, D-19)', () => {
  const run = (...events: OpenEvent[]) => events.reduce(transition, INITIAL);

  it('opening → password → opening → ready', () => {
    expect(run({ type: 'read' }, { type: 'needs-password', retry: false })).toEqual({
      phase: 'password',
      retry: false,
    });
    expect(
      run(
        { type: 'read' },
        { type: 'needs-password', retry: false },
        { type: 'password-given' },
        { type: 'needs-password', retry: true },
      ),
    ).toEqual({ phase: 'password', retry: true });
    expect(
      run(
        { type: 'read' },
        { type: 'needs-password', retry: false },
        { type: 'password-given' },
        { type: 'opened', docId: 'd' },
      ),
    ).toEqual({ phase: 'ready', docId: 'd' });
  });

  it('cancelling the prompt ends the job without an error', () => {
    const s = run(
      { type: 'read' },
      { type: 'needs-password', retry: false },
      { type: 'cancelled' },
    );
    expect(s).toEqual({ phase: 'cancelled' });
    expect(isFinal(s)).toBe(true);
    expect(transition(s, { type: 'failed', kind: 'damaged' })).toBe(s);
  });

  it('password events only apply where they make sense', () => {
    expect(run({ type: 'needs-password', retry: false })).toEqual({ phase: 'reading' });
    expect(run({ type: 'read' }, { type: 'password-given' })).toEqual({ phase: 'opening' });
    expect(run({ type: 'read' }, { type: 'cancelled' })).toEqual({ phase: 'opening' });
  });
});

describe('duplicate detection (M1-13)', () => {
  const handle = (path: string) =>
    ({
      path,
      isSameEntry: (other: { path: string }) => Promise.resolve(other.path === path),
    }) as unknown as FileSystemFileHandle;

  it('compares two handles with isSameEntry, not by fingerprint', async () => {
    const open = new Map<string, Candidate>([
      ['d1', { handle: handle('C:/a.pdf'), fingerprint: 'f1' }],
    ]);
    expect(await findDuplicate({ handle: handle('C:/a.pdf'), fingerprint: 'other' }, open)).toBe(
      'd1',
    );
    // Same content saved elsewhere is a different file on disk: its own tab.
    expect(
      await findDuplicate({ handle: handle('D:/copy.pdf'), fingerprint: 'f1' }, open),
    ).toBeUndefined();
  });

  it('falls back to the fingerprint when either side has no handle', async () => {
    const open = new Map<string, Candidate>([
      ['d1', { fingerprint: 'f1' }],
      ['d2', { handle: handle('C:/b.pdf'), fingerprint: 'f2' }],
    ]);
    expect(await findDuplicate({ fingerprint: 'f1' }, open)).toBe('d1');
    expect(await findDuplicate({ fingerprint: 'f2' }, open)).toBe('d2');
    expect(await findDuplicate({ handle: handle('C:/x.pdf'), fingerprint: 'f1' }, open)).toBe('d1');
    expect(await findDuplicate({ fingerprint: 'f3' }, open)).toBeUndefined();
  });
});

describe('open errors (M1-13)', () => {
  it('finds %PDF- in the first 1 KB only', () => {
    expect(hasPdfHeader(enc.encode('%PDF-1.7\n'))).toBe(true);
    expect(hasPdfHeader(enc.encode(`${'x'.repeat(500)}%PDF-1.4`))).toBe(true);
    expect(hasPdfHeader(enc.encode(`${'x'.repeat(1100)}%PDF-1.4`))).toBe(false);
    expect(hasPdfHeader(enc.encode('hello, world'))).toBe(false);
    expect(hasPdfHeader(new Uint8Array())).toBe(false);
  });

  it('classifies failures', () => {
    expect(classifyOpenError(new OpenError('too-many'), true)).toBe('too-many');
    expect(classifyOpenError({ code: PdfErrorCode.Password, message: '' }, true)).toBe(
      'needs-password',
    );
    expect(classifyOpenError({ reason: { code: PdfErrorCode.Password } }, true)).toBe(
      'needs-password',
    );
    expect(classifyOpenError({ code: PdfErrorCode.WrongFormat, message: '' }, true)).toBe(
      'damaged',
    );
    expect(classifyOpenError({ code: PdfErrorCode.WrongFormat, message: '' }, false)).toBe(
      'not-pdf',
    );
    expect(classifyOpenError(new DOMException('gone', 'NotReadableError'), true)).toBe(
      'unreadable',
    );
    expect(classifyOpenError(new Error('boom'), true)).toBe('unknown');
  });

  it('every kind has a message', () => {
    const open = (en as { open: { error: Record<string, string> } }).open.error;
    for (const key of Object.values(OPEN_ERROR_MESSAGE)) {
      expect(open[key.replace('open.error.', '')]).toBeTruthy();
    }
  });
});

describe('open transfers the bytes (rule 1)', () => {
  it('transfers openDocumentBuffer content and nothing else', () => {
    const content = new ArrayBuffer(8);
    expect(transferablesFor('openDocumentBuffer', [{ id: 'd', content }])).toEqual([content]);
    expect(transferablesFor('getMetadata', [{ id: 'd', content }])).toEqual([]);
    expect(transferablesFor('openDocumentBuffer', [])).toEqual([]);
  });
});
