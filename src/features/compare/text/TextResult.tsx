import { ArrowSync20Filled, ArrowSync20Regular } from '@fluentui/react-icons/svg/arrow-sync';
import { HelpButton } from '../../help/HelpButton';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BAR_CLOSE_CLASS, BarCloseButton } from '../../../app/BarCloseButton';
import { useClosedBars } from '../../../app/infoBars';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import type { OcrLanguage } from '../../../model/ocr/languages';
import {
  entriesOf,
  pageMap,
  stepEntry,
  visibleEntries,
  type Side,
} from '../../../model/compare/textView';
import {
  Button,
  DropdownMenu,
  ProgressBar,
  ToggleButton,
  type MenuEntry,
} from '../../../ui/components';
import { CommandIcon } from '../../../ui/icons/CommandIcon';
import { NewComparisonButton } from '../NewComparisonButton';
import type { Comparison } from '../model';
import { typeLabel } from '../title';
import { BandBar } from './BandBar';
import { ChangeList, Legend } from './ChangeList';
import {
  cancelTextRun,
  changeKey,
  ocrLanguages,
  setRunOptions,
  syncTextRun,
  textInputs,
  updateTextView,
  useTextRun,
  useTextView,
  type TextRun,
} from './textFlow';
import { textLinkOf } from './textLink';
import { TextWindows } from './TextWindows';
import { CloseOutPane } from '../closeout/CloseOutPane';
import { CloseOutToggle } from '../closeout/CloseOutToggle';
import { useCloseOutView } from '../closeout/closeOutStore';
import { ComparePane } from '../layout/ComparePane';
import { MaximiseButton } from '../layout/Maximise';
import { useMaximised } from '../layout/maximised';
import { NEXT_DIFFERENCE_KEY } from '../../../app/keys/windowKeys';

const LANGUAGE: Record<OcrLanguage, MessageKey> = {
  eng: msg('ocr.languages.eng'),
  chi_sim: msg('ocr.languages.chi_sim'),
  hin: msg('ocr.languages.hin'),
  spa: msg('ocr.languages.spa'),
  fra: msg('ocr.languages.fra'),
};

/** Next change; with Shift, the previous one (owner's answer: F8, Shift+F8). */
const NEXT_KEY = NEXT_DIFFERENCE_KEY;

const LIMITED: Record<Side, MessageKey> = {
  a: msg('compare.text.limitedPages_a'),
  b: msg('compare.text.limitedPages_b'),
};

/** Where hand-drawn bands start (pt from the top and from the bottom). */
const START_BAND = 56;

/**
 * The result of a text comparison (M12-19, D-63, D-64, ARCHITECTURE §7.16):
 * Document A and Document B side by side with the bands across the gap,
 * the legend and the list of changes on the right, the switches and the
 * progress in the head. Compare starts the comparison's work in the workers;
 * the changes fill in as the pages are compared.
 */
export function TextResult({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const titleId = useId();
  // What the run reads of the documents (not their views: the windows change those all the time).
  const inputsKey = useDocuments((s) => textInputs(c, s.docs)?.key ?? null);
  useEffect(() => {
    syncTextRun(c);
  }, [c, inputsKey]);
  const run = useTextRun(c.id);
  const view = useTextView(c.id);
  const closeOutOpen = useCloseOutView(c.id).open;
  // Maximise leaves the two windows only (M12-25, ADR-033).
  const max = useMaximised(c.id);

  const entries = useMemo(() => entriesOf(run?.result ?? null), [run?.result]);
  const checked = useMemo(() => {
    const keys = new Set(view.checked);
    return new Set(entries.filter((e) => keys.has(changeKey(e.change))).map((e) => e.id));
  }, [entries, view.checked]);
  const visible = useMemo(
    () => visibleEntries(entries, view.filter, checked),
    [entries, view.filter, checked],
  );
  const selected = useMemo(() => {
    if (view.selected === null) return null;
    return entries.find((e) => changeKey(e.change) === view.selected)?.id ?? null;
  }, [entries, view.selected]);
  const pageOf = useMemo(
    () =>
      run
        ? { a: pageMap(run.inputs.a.pages), b: pageMap(run.inputs.b.pages) }
        : { a: () => undefined, b: () => undefined },
    [run],
  );

  const select = (entry: number): void => {
    const e = entries[entry];
    if (!e) return;
    updateTextView(c.id, (v) => ({ ...v, selected: changeKey(e.change) }));
    textLinkOf(c.id)?.centreEntry(entry);
  };
  const step = (dir: 1 | -1): void => {
    const to = stepEntry(visible, selected, dir);
    if (to !== null) select(to);
  };

  // F8 / Shift+F8: next and previous change while this comparison is the tab in use.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== NEXT_KEY || e.ctrlKey || e.altKey || e.metaKey) return;
      if (documentStore.getState().activeTab !== c.id) return;
      e.preventDefault();
      stepRef.current(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [c.id, stepRef]);

  const options: MenuEntry[] = [
    {
      kind: 'checkbox',
      id: 'headersFooters',
      label: t('compare.text.headersFooters'),
      checked: view.options.headersFooters,
      onCheckedChange: (on) => {
        setRunOptions(c, (o) => ({ ...o, headersFooters: on, bands: null }));
      },
    },
    {
      kind: 'checkbox',
      id: 'renumbering',
      label: t('compare.text.renumbering'),
      checked: view.options.renumbering,
      onCheckedChange: (on) => {
        setRunOptions(c, (o) => ({ ...o, renumbering: on }));
      },
    },
    {
      id: 'bands',
      label: t('compare.text.drawBands'),
      onSelect: () => {
        updateTextView(c.id, (v) => ({
          ...v,
          bandEdit: {
            a: v.options.bands?.a ?? { top: START_BAND, bottom: START_BAND },
            b: v.options.bands?.b ?? { top: START_BAND, bottom: START_BAND },
          },
        }));
      },
    },
    ...(view.options.bands
      ? [
          {
            id: 'autoBands',
            label: t('compare.text.autoBands'),
            onSelect: () => {
              setRunOptions(c, (o) => ({ ...o, bands: null }));
            },
          },
        ]
      : []),
  ];

  return (
    <section
      className="compare-result text-result"
      aria-labelledby={titleId}
      data-testid="compare-result"
      data-type="text"
      data-status={run?.status ?? 'reading'}
      data-help-topic="compare-text"
    >
      <header className="overlay-head ui-compact-bar">
        <span className="overlay-head-icon" aria-hidden="true">
          <CommandIcon id="compare.text" />
        </span>
        <h2 id={titleId} className="overlay-head-title">
          {typeLabel(c.type)}
          <span className="compare-preview">{t('compare.preview')}</span>
        </h2>
        <RunStatus id={c.id} run={run} />
        <div className="overlay-head-layout">
          <ToggleButton
            label={t('compare.text.sync')}
            tooltip={t('compare.text.syncTip')}
            compact
            icon={<ArrowSync20Regular />}
            pressedIcon={<ArrowSync20Filled />}
            pressed={view.sync}
            onPressedChange={(on) => {
              updateTextView(c.id, (v) => ({ ...v, sync: on }));
            }}
          />
          <DropdownMenu
            trigger={
              <Button
                label={t('compare.text.options')}
                size="small"
                icon={<ChevronDown16Regular />}
              />
            }
            entries={options}
          />
          <CloseOutToggle id={c.id} />
        </div>
        {run ? <MaximiseButton id={c.id} /> : null}
        <NewComparisonButton id={c.id} />
        <HelpButton topic="compare-text" label={t('compare.help')} />
      </header>
      {view.bandEdit ? <BandBar comparison={c} /> : null}
      {run ? <Notices comparison={c} run={run} /> : null}
      {run ? (
        <div className="text-body">
          <TextWindows
            id={c.id}
            run={run}
            entries={entries}
            visible={visible}
            selected={selected}
          />
          {max ? null : (
            <ComparePane id={c.id} pane="changes" side="right" name={t('compare.text.list')}>
              <aside className="text-side" aria-label={t('compare.text.list')}>
                <Legend id={c.id} entries={entries} />
                <ChangeList
                  id={c.id}
                  entries={entries}
                  visible={visible}
                  selected={selected}
                  checked={checked}
                  pageOf={pageOf}
                  onSelect={select}
                  onStep={step}
                  total={entries.length}
                />
              </aside>
            </ComparePane>
          )}
          {closeOutOpen && !max ? (
            <ComparePane id={c.id} pane="closeout" side="right" name={t('compare.closeout.title')}>
              <CloseOutPane comparison={c} />
            </ComparePane>
          ) : null}
        </div>
      ) : (
        <div className="overlay-wait" role="status">
          <ProgressBar label={t('compare.text.progress')} value={null} />
        </div>
      )}
    </section>
  );
}

/** Progress and Stop while the comparison runs; what happened when it did not finish. */
function RunStatus({ id, run }: { id: string; run: TextRun | undefined }) {
  const { t } = useTranslation();
  if (!run) return null;
  const { done, total } = run.progress;
  if (run.status === 'reading' || run.status === 'matching') {
    const text =
      run.status === 'reading'
        ? t('compare.text.reading', { done: format.number(done), total: format.number(total) })
        : t('compare.text.matching', { done: format.number(done), total: format.number(total) });
    return (
      <div className="text-run" role="status" data-testid="text-run">
        <span className="text-run-text">{text}</span>
        <ProgressBar label={t('compare.text.progress')} value={total > 0 ? done / total : null} />
        <Button
          label={t('compare.text.cancel')}
          size="small"
          onClick={() => {
            cancelTextRun(id);
          }}
        />
      </div>
    );
  }
  if (run.status === 'failed' || run.status === 'cancelled')
    return (
      <p className="text-run" role="status" data-testid="text-run">
        {run.status === 'failed' ? t('compare.text.failed') : t('compare.text.cancelled')}
      </p>
    );
  return null;
}

/** The comparison header's first button: the focus once the last note is closed. */
const HEADER_BUTTON = 'header button';

/** Scans to read by OCR (Q29), pages of limited support, and early results. */
function Notices({ comparison: c, run }: { comparison: Comparison; run: TextRun }) {
  const { t } = useTranslation();
  const view = useTextView(c.id);
  const closed = useClosedBars();
  const box = useRef<HTMLDivElement>(null);
  const r = run.result;
  if (!r) return null;
  const notes: { key: string; text: string; action?: { label: string; run: () => void } }[] = [];
  const langs = (codes: readonly OcrLanguage[]): string =>
    format.list(codes.map((code) => t(LANGUAGE[code])));
  const scanned = r.scanned.a.length + r.scanned.b.length;
  if (view.options.ocr)
    notes.push({
      key: 'ocr',
      text: t('compare.text.ocrOn', { languages: langs(view.options.ocr) }),
    });
  else if (scanned > 0) {
    const languages = ocrLanguages();
    notes.push({
      key: 'scanned',
      text: t('compare.text.scanned', { count: scanned }),
      action: {
        label: t('compare.text.readOcr', { languages: langs(languages) }),
        run: () => {
          setRunOptions(c, (o) => ({ ...o, ocr: languages }));
        },
      },
    });
  }
  const pageList = (side: Side, pages: number[]): string | null => {
    const doc = pages
      .filter((p) => !r.scanned[side].includes(p) || view.options.ocr)
      .map((p) => run.inputs[side].pages[p])
      .filter((p): p is number => p !== undefined);
    if (doc.length === 0) return null;
    return t(LIMITED[side], {
      pages: format.list(doc.map((p) => format.number(p + 1))),
    });
  };
  const limited = [pageList('a', r.limited.a), pageList('b', r.limited.b)].filter(
    (s): s is string => s !== null,
  );
  if (limited.length)
    notes.push({
      key: 'limited',
      text: t('compare.text.limited', { pages: format.list(limited) }),
    });
  if (run.state && !run.state.complete && run.status !== 'cancelled')
    notes.push({
      key: 'early',
      text: t('compare.text.early', {
        pages: format.number(Math.max(run.state.pages.a, run.state.pages.b)),
      }),
    });
  // Each note has a × that closes it for this comparison (M13-04).
  const shown = notes.filter((n) => !closed.has(`text-notice:${c.id}:${n.key}`));
  if (shown.length === 0) return null;
  return (
    <div className="text-notices" ref={box}>
      {shown.map((n) => (
        <p key={n.key} className="text-notice" data-testid={`text-notice-${n.key}`}>
          <span>{n.text}</span>
          {n.action ? <Button label={n.action.label} size="small" onClick={n.action.run} /> : null}
          <BarCloseButton
            barKey={`text-notice:${c.id}:${n.key}`}
            afterClose={() => {
              // The next note's ×, or the comparison's header when none is left.
              const next =
                box.current?.querySelector<HTMLElement>(`.${BAR_CLOSE_CLASS}`) ??
                box.current?.parentElement?.querySelector<HTMLElement>(HEADER_BUTTON);
              next?.focus();
            }}
          />
        </p>
      ))}
    </div>
  );
}
