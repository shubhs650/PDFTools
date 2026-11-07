import { PdfActionType, PdfZoomMode } from '@embedpdf/models';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg } from '../../i18n';
import {
  itemAt,
  keyPath,
  type DestSpec,
  type ItemProps,
  type OutlineItem,
  type Rgb,
} from '../../model/outline';
import { Button, ColorPicker, Dialog, TextField } from '../../ui/components';
import { internalDestination } from '../view/links';
import { pageSizeOf } from '../view/pagePoint';
import { closeProperties, editBlocked, runEdit, useBookmarks } from './bookmarks';
import { dialogHelp } from '../help/openHelp';

type ZoomChoice = 'inherit' | 'fitPage' | 'fitWidth' | 'custom';
const MIN_PCT = 1;
const MAX_PCT = 6400;

const hex = (c: Rgb | null): string =>
  `#${(c ?? [0, 0, 0])
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const rgbOf = (h: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;

interface DestFields {
  page: string;
  zoom: ZoomChoice;
  pct: string;
}

/** The dialog's starting destination fields (empty page: the bookmark goes nowhere yet). */
function destFields(item: OutlineItem): DestFields & { left: number | null; top: number | null } {
  const d = internalDestination(item.target);
  if (!d || d.pageIndex < 0)
    return { page: '', zoom: 'inherit', pct: '100', left: null, top: null };
  const page = String(d.pageIndex + 1);
  switch (d.zoom.mode) {
    case PdfZoomMode.XYZ: {
      const { x, y, zoom } = d.zoom.params;
      return zoom > 0
        ? { page, zoom: 'custom', pct: String(Math.round(zoom * 100)), left: x, top: y }
        : { page, zoom: 'inherit', pct: '100', left: x, top: y };
    }
    case PdfZoomMode.FitPage:
    case PdfZoomMode.FitBoundingBox:
      return { page, zoom: 'fitPage', pct: '100', left: null, top: null };
    case PdfZoomMode.FitHorizontal:
    case PdfZoomMode.FitBoundingBoxHorizontal:
      return { page, zoom: 'fitWidth', pct: '100', left: null, top: d.view[0] ?? null };
    default:
      return { page, zoom: 'inherit', pct: '100', left: null, top: null };
  }
}

/**
 * Bookmark Properties (M6-11, §7.15): title, colour, bold / italic and the
 * destination (page and zoom). A bookmark that runs an action (a web link,
 * another file) shows it; Set Destination replaces it. OK makes one undo step
 * with only what changed.
 */
export function BookmarkPropertiesDialog() {
  const open = useBookmarks((s) => s.properties);
  const items = useBookmarks((s) => {
    const o = s.properties ? s.outlines[s.properties.docId] : undefined;
    return o?.state === 'ready' ? o.items : null;
  });
  const item = open && items ? itemAt(items, keyPath(open.key)) : null;
  if (!open || !item) return null;
  return (
    <PropertiesForm
      key={`${open.docId}:${open.key}`}
      docId={open.docId}
      path={keyPath(open.key)}
      item={item}
    />
  );
}

function PropertiesForm({
  docId,
  path,
  item,
}: {
  docId: string;
  path: number[];
  item: OutlineItem;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const start = destFields(item);
  const [title, setTitle] = useState(item.title);
  const [color, setColor] = useState(hex(item.color));
  const [bold, setBold] = useState(item.bold);
  const [italic, setItalic] = useState(item.italic);
  const [page, setPage] = useState(start.page);
  const [zoom, setZoom] = useState<ZoomChoice>(start.zoom);
  const [pct, setPct] = useState(start.pct);
  const action = item.target?.type === 'action' ? item.target.action : null;
  const external = action !== null && action.type !== PdfActionType.Goto;
  const readOnly = editBlocked(docId) !== null;

  const titleOk = title.trim().length > 0;
  const pageNum = Number(page);
  const pageOk = page === '' || (Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= pageCount);
  const pctNum = Number(pct);
  const pctOk =
    zoom !== 'custom' || (Number.isFinite(pctNum) && pctNum >= MIN_PCT && pctNum <= MAX_PCT);
  const ok = titleOk && pageOk && pctOk && !readOnly;

  const destOf = (): DestSpec | undefined => {
    if (external || page === '') return undefined;
    if (page === start.page && zoom === start.zoom && (zoom !== 'custom' || pct === start.pct))
      return undefined;
    const index = pageNum - 1;
    const samePage = page === start.page;
    const top =
      samePage && start.top !== null ? start.top : (pageSizeOf(docId, index)?.height ?? null);
    const left = samePage && start.left !== null ? start.left : 0;
    if (zoom === 'fitPage') return { page: index, fit: 'fit' };
    if (zoom === 'fitWidth') return { page: index, fit: 'fitH', top };
    return { page: index, fit: 'xyz', left, top, zoom: zoom === 'custom' ? pctNum / 100 : null };
  };

  const submit = (): void => {
    if (!ok) return;
    const props: ItemProps = {};
    if (title.trim() !== item.title) props.title = title.trim();
    if (color !== hex(item.color)) props.color = rgbOf(color);
    if (bold !== item.bold) props.bold = bold;
    if (italic !== item.italic) props.italic = italic;
    const dest = destOf();
    if (dest) props.dest = dest;
    closeProperties();
    if (Object.keys(props).length)
      void runEdit(docId, { kind: 'update', path, props }, msg('bookmarks.editing'));
  };

  const zoomLabels: Record<ZoomChoice, string> = {
    inherit: t('bookmarks.props.zoomInherit'),
    fitPage: t('bookmarks.props.zoomFitPage'),
    fitWidth: t('bookmarks.props.zoomFitWidth'),
    custom: t('bookmarks.props.zoomCustom'),
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeProperties();
      }}
      title={t('bookmarks.props.title')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('bookmarks')}
      footer={
        <>
          <Button
            label={t('bookmarks.props.ok')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ok}
          />
          <Button label={t('bookmarks.props.cancel')} onClick={closeProperties} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form bookmark-props"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('bookmarks.props.name')}
          value={title}
          maxLength={1000}
          disabled={readOnly}
          error={titleOk ? undefined : t('bookmarks.props.badTitle')}
          onChange={(e) => {
            setTitle(e.currentTarget.value);
          }}
        />
        <div className="bookmark-props-style">
          <div className="ui-field bookmark-props-color">
            <label className="ui-field-label" htmlFor={`${ids}-color`}>
              {t('bookmarks.props.color')}
            </label>
            <ColorPicker
              id={`${ids}-color`}
              label={t('bookmarks.props.color')}
              value={color}
              disabled={readOnly}
              onChange={setColor}
            />
          </div>
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={bold}
              disabled={readOnly}
              onChange={(e) => {
                setBold(e.currentTarget.checked);
              }}
            />
            {t('bookmarks.props.bold')}
          </label>
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={italic}
              disabled={readOnly}
              onChange={(e) => {
                setItalic(e.currentTarget.checked);
              }}
            />
            {t('bookmarks.props.italic')}
          </label>
        </div>
        <fieldset className="scale-where" disabled={readOnly}>
          <legend className="ui-field-label">{t('bookmarks.props.destination')}</legend>
          {external ? (
            <p className="bookmark-props-action" data-testid="bookmark-action">
              {action.type === PdfActionType.URI
                ? t('bookmarks.props.actionUri', { url: action.uri })
                : t('bookmarks.props.actionOther', { type: item.action ?? '' })}
            </p>
          ) : (
            <>
              <TextField
                label={t('bookmarks.props.page')}
                inputMode="numeric"
                value={page}
                placeholder={item.target ? undefined : t('bookmarks.props.noTarget')}
                error={
                  pageOk
                    ? undefined
                    : t('bookmarks.props.badPage', { count: format.number(pageCount, 0) })
                }
                onChange={(e) => {
                  setPage(e.currentTarget.value);
                }}
              />
              <div className="ui-field">
                <label className="ui-field-label" htmlFor={`${ids}-zoom`}>
                  {t('bookmarks.props.zoom')}
                </label>
                <select
                  id={`${ids}-zoom`}
                  className="ui-field-input prop-select"
                  value={zoom}
                  onChange={(e) => {
                    setZoom(e.currentTarget.value as ZoomChoice);
                  }}
                >
                  {(Object.keys(zoomLabels) as ZoomChoice[]).map((z) => (
                    <option key={z} value={z}>
                      {zoomLabels[z]}
                    </option>
                  ))}
                </select>
              </div>
              {zoom === 'custom' ? (
                <TextField
                  label={t('bookmarks.props.percent')}
                  inputMode="decimal"
                  value={pct}
                  error={
                    pctOk
                      ? undefined
                      : t('bookmarks.props.badZoom', {
                          min: format.number(MIN_PCT, 0),
                          max: format.number(MAX_PCT, 0),
                        })
                  }
                  onChange={(e) => {
                    setPct(e.currentTarget.value);
                  }}
                />
              ) : null}
            </>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
