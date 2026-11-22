import { ArrowDown16Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowSwap20Regular } from '@fluentui/react-icons/svg/arrow-swap';
import { ArrowUp16Regular } from '@fluentui/react-icons/svg/arrow-up';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments, type DocumentsState } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, DropdownMenu, IconButton, TextField } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { collectDropped, hasFiles } from '../open/dropped';
import { openUnlockDialog } from '../protect/unlock';
import { ThumbImage } from '../thumbnails/ThumbImage';
import { usePages } from '../thumbnails/pageInfo';
import {
  addFilesTo,
  addOpenDocument,
  openingCount,
  pickFilesFor,
  updateInputs,
  useCompareUi,
} from './compareFlow';
import {
  COMPARE_TYPES,
  compareBlock,
  moveFile,
  rangePages,
  removeFile,
  setRange,
  sidePageCount,
  swapSides,
  withType,
  type CompareBlock,
  type CompareType,
  type Comparison,
  type SideFile,
  type SideId,
} from './model';
import { PairingTable } from './PairingTable';
import { syncPairing, usePairing } from './pairingFlow';
import { comparedPairs } from '../../model/compare/pairing';
import { limitsOf } from './permissions';
import { typeLabel } from './title';
import type { RangeError } from '../print/options';

/** Thumbnails shown per file; the rest are counted ("+ 12 more pages"). */
const THUMBS = 6;
const THUMB_WIDTH = 72;

const SIDE_LABEL: Record<SideId, MessageKey> = {
  a: msg('compare.side.a'),
  b: msg('compare.side.b'),
};

const RANGE_ERROR: Record<RangeError, MessageKey> = {
  empty: msg('compare.range.empty'),
  syntax: msg('compare.range.syntax'),
  outOfRange: msg('compare.range.outOfRange'),
};

const COMMAND: Record<CompareType, string> = { overlay: 'compare.overlay', text: 'compare.text' };

/**
 * A comparison tab (M12-08, D-58, ARCHITECTURE §7.16): its input window, and the result
 * once Compare is pressed (later tasks fill the result; the inputs can be revisited).
 */
export function CompareTab({ id }: { id: string }) {
  const comparison = useDocuments((s) => s.comparisons[id]);
  if (!comparison) return null;
  return comparison.stage === 'input' ? (
    <InputWindow comparison={comparison} />
  ) : (
    <ResultStage comparison={comparison} />
  );
}

const pageCountOf =
  (s: DocumentsState) =>
  (docId: string): number | undefined =>
    s.docs[docId]?.meta.pageCount;

function InputWindow({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const titleId = useId();
  const statusId = useId();
  const docs = useDocuments((s) => s.docs);
  const inputBlock = compareBlock(c, (d) => docs[d]?.meta.pageCount);
  const opening = useCompareUi((s) => openingCount(s, c.id, 'a') + openingCount(s, c.id, 'b'));
  // An overlay pairs its pages as soon as both sides are ready (M12-09, D-60).
  useEffect(() => {
    syncPairing(c);
  }, [c, docs]);
  const pairing = usePairing(c.id);
  const overlay = c.type === 'overlay';
  let block: CompareBlock | null = inputBlock;
  if (!block && overlay) {
    if (pairing?.status !== 'done') block = { kind: 'pairing' };
    else if (comparedPairs(pairing.rows).length === 0) block = { kind: 'noSheets' };
  }
  const nameOf = (d: string): string => docs[d]?.meta.name ?? '';
  const blockText = (b: CompareBlock): string => {
    switch (b.kind) {
      case 'empty':
        return t('compare.block.empty', { side: t(SIDE_LABEL[b.side]) });
      case 'opening':
        return t('compare.block.opening');
      case 'range':
        return t('compare.block.range', { name: nameOf(b.docId) });
      case 'pairing':
        return pairing?.status === 'failed'
          ? t('compare.pairing.failed')
          : t('compare.block.pairing');
      case 'noSheets':
        return t('compare.block.noSheets');
    }
  };
  const count = (files: readonly SideFile[]): number =>
    sidePageCount(files, (d) => docs[d]?.meta.pageCount);
  const status = block
    ? blockText(opening > 0 ? { kind: 'opening' } : block)
    : t('compare.ready', {
        a: t('compare.pages', { count: count(c.a) }),
        b: t('compare.pages', { count: count(c.b) }),
      });
  const setType = (type: CompareType): void => {
    updateInputs(c.id, (cur) => withType(cur, type));
  };
  return (
    <section
      className="compare"
      aria-labelledby={titleId}
      data-testid="compare-input"
      data-type={c.type}
    >
      <div className="compare-column">
        <header className="compare-head">
          <span className="start-badge" aria-hidden="true">
            <CommandIcon id={COMMAND[c.type]} />
          </span>
          <div className="compare-head-text">
            <h2 id={titleId} className="compare-title">
              {typeLabel(c.type)}
              <span className="compare-preview">{t('compare.preview')}</span>
            </h2>
            <p className="compare-intro">
              {c.type === 'overlay' ? t('compare.intro.overlay') : t('compare.intro.text')}
            </p>
          </div>
          <fieldset className="compare-type">
            <legend className="ui-visually-hidden">{t('compare.typeLabel')}</legend>
            {COMPARE_TYPES.map((type) => (
              <label key={type} className="compare-type-option">
                <input
                  type="radio"
                  name={`compare-type-${c.id}`}
                  className="ui-focusable"
                  checked={c.type === type}
                  onChange={() => {
                    setType(type);
                  }}
                />
                <span>{typeLabel(type)}</span>
              </label>
            ))}
          </fieldset>
        </header>
        <div className="compare-sides">
          <SidePanel comparison={c} side="a" />
          <div className="compare-swap">
            <IconButton
              label={t('compare.swap')}
              icon={<ArrowSwap20Regular />}
              disabled={c.a.length + c.b.length === 0}
              onClick={() => {
                updateInputs(c.id, swapSides);
              }}
            />
          </div>
          <SidePanel comparison={c} side="b" />
        </div>
        {overlay && !inputBlock ? <PairingTable id={c.id} /> : null}
        <footer className="compare-foot">
          <p id={statusId} className="compare-status" role="status">
            {status}
          </p>
          <Button
            label={t('compare.run')}
            variant="primary"
            disabled={block !== null}
            aria-describedby={statusId}
            onClick={() => {
              updateInputs(c.id, (cur) => ({ ...cur, stage: 'result' }));
            }}
          />
        </footer>
      </div>
    </section>
  );
}

function SidePanel({ comparison: c, side }: { comparison: Comparison; side: SideId }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [over, setOver] = useState(false);
  const files = c[side];
  const opening = useCompareUi((s) => openingCount(s, c.id, side));
  const order = useDocuments((s) => s.order);
  const docs = useDocuments((s) => s.docs);
  // Open tabs whose document can go on this side (not one already here).
  const tabs = order.filter((d) => docs[d] && !files.some((f) => f.docId === d));
  const overlay = c.type === 'overlay';

  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    setOver(false);
    if (!hasFiles(e.dataTransfer)) return;
    // This side takes the files, not the window (which would open them in tabs).
    e.preventDefault();
    e.stopPropagation();
    void collectDropped(e.dataTransfer).then((dropped) =>
      addFilesTo(c.id, side, dropped, 'dropped'),
    );
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a drop target; its buttons give the keyboard path
    <section
      className="compare-side"
      aria-labelledby={headingId}
      data-testid={`compare-side-${side}`}
      data-over={over ? '' : undefined}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <h3 id={headingId} className="compare-side-title">
        {t(SIDE_LABEL[side])}
      </h3>
      {files.length === 0 ? (
        <p className="compare-side-hint">
          {overlay ? t('compare.hint.overlay') : t('compare.hint.text')}
        </p>
      ) : (
        <ul
          className="compare-files"
          aria-label={t('compare.filesOf', { side: t(SIDE_LABEL[side]) })}
        >
          {files.map((f, i) => (
            <FileItem
              key={f.docId}
              comparison={c}
              side={side}
              file={f}
              index={i}
              count={files.length}
            />
          ))}
        </ul>
      )}
      {opening > 0 ? (
        <p className="compare-opening" role="status">
          <span className="ui-spinner compare-spinner" aria-hidden="true" />
          <span>{t('compare.opening', { count: opening })}</span>
        </p>
      ) : null}
      <div className="compare-side-actions">
        <Button
          label={
            overlay ? t('compare.add') : files.length ? t('compare.replace') : t('compare.choose')
          }
          size="small"
          onClick={() => {
            void pickFilesFor(c.id, side);
          }}
        />
        <DropdownMenu
          trigger={
            <Button
              label={t('compare.openTab')}
              size="small"
              icon={<ChevronDown16Regular />}
              disabled={tabs.length === 0}
            />
          }
          entries={tabs.map((d) => ({
            id: d,
            label: docs[d]?.meta.name ?? d,
            onSelect: () => {
              addOpenDocument(c.id, side, d);
            },
          }))}
        />
      </div>
    </section>
  );
}

function FileItem({
  comparison: c,
  side,
  file,
  index,
  count,
}: {
  comparison: Comparison;
  side: SideId;
  file: SideFile;
  index: number;
  count: number;
}) {
  const { t } = useTranslation();
  const doc = useDocuments((s) => s.docs[file.docId]);
  const pages = usePages(file.docId);
  if (!doc) return null;
  const name = doc.meta.name;
  const range = rangePages(file.range, doc.meta.pageCount);
  const chosen = range.ok ? range.pages : [];
  const shown = chosen.slice(0, THUMBS);
  const limits = limitsOf(securityOf(doc.meta));
  const set = (fn: (cur: Comparison) => Comparison): void => {
    updateInputs(c.id, fn);
  };
  return (
    <li className="compare-file" data-testid="compare-file">
      <div className="compare-file-head">
        <span className="compare-file-name">{name}</span>
        <span className="compare-file-pages">
          {t('compare.pages', { count: doc.meta.pageCount })}
        </span>
        {count > 1 ? (
          <>
            <IconButton
              label={t('compare.moveUp', { name })}
              icon={<ArrowUp16Regular />}
              size="small"
              disabled={index === 0}
              onClick={() => {
                set((cur) => moveFile(cur, side, file.docId, -1));
              }}
            />
            <IconButton
              label={t('compare.moveDown', { name })}
              icon={<ArrowDown16Regular />}
              size="small"
              disabled={index === count - 1}
              onClick={() => {
                set((cur) => moveFile(cur, side, file.docId, 1));
              }}
            />
          </>
        ) : null}
        <IconButton
          label={t('compare.remove', { name })}
          icon={<Dismiss16Regular />}
          size="small"
          onClick={() => {
            set((cur) => removeFile(cur, side, file.docId));
          }}
        />
      </div>
      <TextField
        className="compare-range"
        label={t('compare.range.label', { name })}
        placeholder={t('compare.range.all')}
        value={file.range}
        error={range.ok ? undefined : t(RANGE_ERROR[range.error])}
        onChange={(e) => {
          const value = e.currentTarget.value;
          set((cur) => setRange(cur, side, file.docId, value));
        }}
      />
      {shown.length > 0 ? (
        <div className="compare-thumbs" aria-hidden="true">
          {shown.map((p) => {
            const info = pages[p];
            return (
              <figure key={p} className="compare-thumb">
                <div className="compare-thumb-page">
                  {info ? (
                    <ThumbImage
                      documentId={file.docId}
                      pageIndex={p}
                      page={info}
                      width={THUMB_WIDTH}
                      priority={p}
                    />
                  ) : null}
                </div>
                <figcaption>{format.number(p + 1)}</figcaption>
              </figure>
            );
          })}
          {chosen.length > shown.length ? (
            <span className="compare-thumbs-more">
              {t('compare.morePages', { count: chosen.length - shown.length })}
            </span>
          ) : null}
        </div>
      ) : null}
      {limits.comment || limits.copy ? (
        <div className="compare-limits">
          <p className="compare-limits-text">
            {limits.comment && limits.copy
              ? t('compare.limits.both', { name })
              : limits.comment
                ? t('compare.limits.comment', { name })
                : t('compare.limits.copy', { name })}
          </p>
          <Button
            label={t('compare.limits.unlock', { name })}
            size="small"
            onClick={() => {
              openUnlockDialog(file.docId);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The result (M12-08: a placeholder until the overlay and text views arrive in later
 * tasks): what will be compared, and the way back to the inputs.
 */
function ResultStage({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const titleId = useId();
  const count = {
    a: useDocuments((s) => sidePageCount(c.a, pageCountOf(s))),
    b: useDocuments((s) => sidePageCount(c.b, pageCountOf(s))),
  };
  return (
    <section className="compare" aria-labelledby={titleId} data-testid="compare-result">
      <div className="compare-column">
        <header className="compare-head">
          <span className="start-badge" aria-hidden="true">
            <CommandIcon id={COMMAND[c.type]} />
          </span>
          <div className="compare-head-text">
            <h2 id={titleId} className="compare-title">
              {typeLabel(c.type)}
              <span className="compare-preview">{t('compare.preview')}</span>
            </h2>
            <p className="compare-intro">
              {t('compare.result.pending', {
                a: t('compare.pages', { count: count.a }),
                b: t('compare.pages', { count: count.b }),
              })}
            </p>
          </div>
        </header>
        <div className="compare-foot">
          <Button
            label={t('compare.result.inputs')}
            onClick={() => {
              updateInputs(c.id, (cur) => ({ ...cur, stage: 'input' }));
            }}
          />
        </div>
      </div>
    </section>
  );
}
