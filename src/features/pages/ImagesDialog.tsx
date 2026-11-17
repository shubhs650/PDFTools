import { ArrowDown16Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowUp16Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Delete16Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import {
  IMAGE_PAGE_SIZES,
  IMAGES_MAX,
  IMAGES_MAX_BYTES,
  turnsQuarter,
  type ImagePageSize,
} from '../../model/imagePages';
import { Button, Dialog, IconButton, TextField } from '../../ui/components';
import { dialogHelp } from '../help/openHelp';
import {
  clearSkipped,
  closeImagesDialog,
  createFromImages,
  insertImages,
  moveImage,
  pickMoreImages,
  removeImage,
  useImages,
  type ImageItem,
  type ImagesOptions,
} from './images';
import { insertAt, type Where } from './sizes';

// Images to PDF and Insert from Image (M11-08·O8, D-55): the images in page
// order (drag, or Move up/down for the keyboard), the page size (fit, A4 or
// Letter, which turns to match each image) and a margin; Insert also asks
// where. The choices are kept for the next time in this session.

const SIZE_LABEL: Record<ImagePageSize, MessageKey> = {
  fit: msg('images.size.fit'),
  a4: msg('images.size.a4'),
  letter: msg('images.size.letter'),
};
const WHERES: readonly Where[] = ['before', 'after'];
const WHERE_LABEL: Record<Where, MessageKey> = {
  before: msg('pages.insert.before'),
  after: msg('pages.insert.after'),
};

let last: ImagesOptions = { size: 'fit', margin: true };

export function ImagesDialog() {
  const open = useImages((s) => s.open);
  if (!open) return null;
  return open.mode === 'insert' ? (
    <ImagesForm key={open.docId} docId={open.docId} />
  ) : (
    <ImagesForm key="new" docId={null} />
  );
}

/** A thumbnail from the file itself: the browser decodes it off the main thread and turns it as the camera meant. */
function Thumb({ url }: { url: string }) {
  return (
    <span className="images-thumb" aria-hidden="true">
      <img src={url} alt="" decoding="async" loading="lazy" />
    </span>
  );
}

function ImagesForm({ docId }: { docId: string | null }) {
  const { t } = useTranslation();
  const ids = useId();
  const items = useImages((s) => s.items);
  const skipped = useImages((s) => s.skipped);
  const overflow = useImages((s) => s.overflow);
  const pageCount = useDocuments((s) => (docId ? (s.docs[docId]?.meta.pageCount ?? 0) : 0));
  const current = useDocuments((s) => (docId ? (s.docs[docId]?.view.page ?? 0) : 0));
  const [options, setOptions] = useState<ImagesOptions>(() => last);
  const [where, setWhere] = useState<Where>('after');
  const [pageText, setPageText] = useState(String(current + 1));
  const [dragged, setDragged] = useState<number | null>(null);
  const insert = docId !== null;
  const page = Number(pageText);
  const pageOk = !insert || (Number.isInteger(page) && page >= 1 && page <= pageCount);
  const tooLarge = items.reduce((n, i) => n + i.file.size, 0) > IMAGES_MAX_BYTES;
  const ready = items.length > 0 && pageOk && !tooLarge;

  const sizeText = (item: ImageItem) => {
    const { width, height } = item.info;
    const shown = turnsQuarter(item.info.orientation)
      ? { w: height, h: width }
      : { w: width, h: height };
    return t('images.pixels', {
      width: format.number(shown.w, 0),
      height: format.number(shown.h, 0),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeImagesDialog();
      }}
      title={insert ? t('images.insertTitle') : t('images.title')}
      description={insert ? t('images.insertDescription') : t('images.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp(insert ? 'organize-pages' : 'opening-files')}
      className="images-dialog"
      footer={
        <>
          <Button
            label={insert ? t('images.insertConfirm') : t('images.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ready}
          />
          <Button label={t('images.cancel')} onClick={closeImagesDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          last = options;
          const list = [...items];
          closeImagesDialog();
          if (docId) void insertImages(docId, list, options, insertAt(where, page - 1, pageCount));
          else void createFromImages(list, options);
        }}
      >
        <div className="images-add">
          <Button
            label={t('images.add')}
            onClick={() => {
              void pickMoreImages();
            }}
          />
          <span className="print-note" data-testid="images-count">
            {t('images.count', { count: items.length, n: format.number(items.length, 0) })}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="print-note">{t('images.empty')}</p>
        ) : (
          <ol className="images-list" aria-label={t('images.list')} data-testid="images-list">
            {items.map((item, i) => (
              // Drag is the pointer shortcut; the Move up/down buttons are the keyboard path (rule 12).
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={item.id}
                className={dragged === i ? 'images-item images-item--dragged' : 'images-item'}
                draggable
                onDragStart={(e: DragEvent) => {
                  setDragged(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e: DragEvent) => {
                  if (dragged !== null) e.preventDefault();
                }}
                onDrop={(e: DragEvent) => {
                  if (dragged === null) return; // files dropped from outside go to the window
                  e.preventDefault();
                  e.stopPropagation();
                  moveImage(dragged, i);
                  setDragged(null);
                }}
                onDragEnd={() => {
                  setDragged(null);
                }}
              >
                <span className="images-number" aria-hidden="true">
                  {format.number(i + 1, 0)}
                </span>
                <Thumb url={item.url} />
                <span className="images-text">
                  <span className="images-name">{item.name}</span>
                  <span className="images-size">{sizeText(item)}</span>
                </span>
                <span className="images-controls">
                  <IconButton
                    label={t('images.up', { name: item.name })}
                    icon={<ArrowUp16Regular />}
                    disabled={i === 0}
                    onClick={() => {
                      moveImage(i, i - 1);
                    }}
                  />
                  <IconButton
                    label={t('images.down', { name: item.name })}
                    icon={<ArrowDown16Regular />}
                    disabled={i === items.length - 1}
                    onClick={() => {
                      moveImage(i, i + 1);
                    }}
                  />
                  <IconButton
                    label={t('images.remove', { name: item.name })}
                    icon={<Delete16Regular />}
                    onClick={() => {
                      removeImage(item.id);
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
        {skipped.length || overflow ? (
          <div className="print-error images-skipped" role="alert">
            {skipped.length ? <p>{t('images.skipped', { names: format.list(skipped) })}</p> : null}
            {overflow ? (
              <p>
                {t('images.overflow', {
                  count: overflow,
                  n: format.number(overflow, 0),
                  max: format.number(IMAGES_MAX, 0),
                })}
              </p>
            ) : null}
            <Button label={t('images.dismissSkipped')} onClick={clearSkipped} />
          </div>
        ) : null}
        {tooLarge ? (
          <p className="print-error" role="alert">
            {t('images.tooLarge', { max: format.number(IMAGES_MAX_BYTES / 1024 / 1024, 0) })}
          </p>
        ) : null}
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('images.size.legend')}</legend>
          {IMAGE_PAGE_SIZES.map((s) => (
            <label key={s} className="scale-radio">
              <input
                type="radio"
                name={`${ids}-size`}
                checked={options.size === s}
                onChange={() => {
                  setOptions((o) => ({ ...o, size: s }));
                }}
              />
              {t(SIZE_LABEL[s])}
            </label>
          ))}
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={options.margin}
              disabled={options.size === 'fit'}
              onChange={(e) => {
                const margin = e.currentTarget.checked;
                setOptions((o) => ({ ...o, margin }));
              }}
            />
            {t('images.margin')}
          </label>
        </fieldset>
        {insert ? (
          <fieldset className="scale-where">
            <legend className="ui-field-label">{t('pages.insertFile.where')}</legend>
            {WHERES.map((w) => (
              <label key={w} className="scale-radio">
                <input
                  type="radio"
                  name={`${ids}-where`}
                  checked={where === w}
                  onChange={() => {
                    setWhere(w);
                  }}
                />
                {t(WHERE_LABEL[w])}
              </label>
            ))}
            <TextField
              label={t('pages.insertFile.page')}
              inputMode="numeric"
              value={pageText}
              error={
                pageOk ? undefined : t('pages.error.page', { max: format.number(pageCount, 0) })
              }
              onChange={(e) => {
                setPageText(e.currentTarget.value);
              }}
            />
          </fieldset>
        ) : null}
        {items.length > 0 ? (
          <p className="scale-preview" data-testid="images-summary">
            {options.size === 'fit'
              ? t('images.summary.fit', { count: items.length, n: format.number(items.length, 0) })
              : options.size === 'a4'
                ? t('images.summary.a4', { count: items.length, n: format.number(items.length, 0) })
                : t('images.summary.letter', {
                    count: items.length,
                    n: format.number(items.length, 0),
                  })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
