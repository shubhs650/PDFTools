// Comment → Comment Styles Palette (M6-07, D-37, beta review B5): the user's
// own styles per tool — add from the tool's current properties, rename,
// delete, reorder — and export/import of every tool's styles as a
// `.pdftools-styles.json` file. The presets are fixed and always in the
// palette. Import is all or nothing, with the reason when a file is refused.
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { uuidV4 } from '@embedpdf/models';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../../i18n';
import { downloadBytes } from '../../../storage/fileAccess';
import { Button, Dialog, TextField } from '../../../ui/components';
import { TOOL_NAME_KEYS } from '../properties/toolProperties';
import {
  addStyle,
  closeStylesDialog,
  deleteStyle,
  exportStylesFile,
  importStylesFile,
  renameStyle,
  reorderStyle,
  setDialogTool,
  stylesOf,
  useCommentStyles,
} from '../tools/commentStylesStore';
import {
  MAX_NAME,
  MAX_STYLES,
  nextStyleNumber,
  PALETTE_TOOLS,
  STYLE_FILE_SUFFIX,
  type StyleFileError,
  type UserStyle,
} from '../tools/stylePalette';
import { isStyleTool, type StyleTool } from '../tools/toolDefaults';
import { defaultsFor } from '../tools/toolDefaultsStore';
import { StyleSwatch } from './StyleSwatch';

const ERRORS: Record<StyleFileError, MessageKey> = {
  tooLarge: msg('stylePalette.error.tooLarge'),
  json: msg('stylePalette.error.json'),
  format: msg('stylePalette.error.format'),
  version: msg('stylePalette.error.version'),
  tool: msg('stylePalette.error.tool'),
  style: msg('stylePalette.error.style'),
  empty: msg('stylePalette.error.empty'),
  tooMany: msg('stylePalette.error.tooMany'),
};

const EXPORT_NAME = 'comment-styles';
const JSON_TYPE = 'application/json';

export function CommentStylesDialog() {
  const open = useCommentStyles((s) => s.dialogOpen);
  if (!open) return null;
  return <StylesContent />;
}

function StylesContent() {
  const { t } = useTranslation();
  const tool = useCommentStyles((s) => s.dialogTool);
  const list = useCommentStyles((s) => stylesOf(s, tool));
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const ids = useId();
  const toolName = t(TOOL_NAME_KEYS[tool]);
  const full = list.length >= MAX_STYLES;

  const add = async (): Promise<void> => {
    const name = t('stylePalette.newName', {
      n: nextStyleNumber(list, (n) => t('stylePalette.newName', { n })),
    });
    if (await addStyle(tool, name, defaultsFor(tool), uuidV4()))
      setMessage(t('stylePalette.added', { name, tool: toolName }));
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeStylesDialog();
      }}
      title={t('stylePalette.title')}
      description={t('stylePalette.description')}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('stylePalette.close')} onClick={closeStylesDialog} />}
    >
      <div className="comment-styles" data-testid="comment-styles-dialog">
        <label htmlFor={`${ids}-tool`}>{t('stylePalette.tool')}</label>
        <select
          id={`${ids}-tool`}
          className="ui-field-input"
          value={tool}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (isStyleTool(v)) setDialogTool(v);
            setRenaming(null);
          }}
        >
          {PALETTE_TOOLS.map((x) => (
            <option key={x} value={x}>
              {t(TOOL_NAME_KEYS[x])}
            </option>
          ))}
        </select>
        {list.length === 0 ? (
          <p className="comment-styles-empty">{t('stylePalette.none', { tool: toolName })}</p>
        ) : (
          <ul
            className="comment-styles-list"
            aria-label={t('stylePalette.listOf', { tool: toolName })}
          >
            {list.map((s, i) => (
              <StyleRow
                key={s.id}
                tool={tool}
                style={s}
                first={i === 0}
                last={i === list.length - 1}
                renaming={renaming === s.id}
                onRename={(on) => {
                  setRenaming(on ? s.id : null);
                }}
                onMessage={setMessage}
              />
            ))}
          </ul>
        )}
        <div className="comment-styles-actions">
          <Button
            label={t('stylePalette.addCurrent')}
            disabled={full}
            onClick={() => {
              void add();
            }}
          />
          <Button
            label={t('stylePalette.export')}
            onClick={() => {
              const blob = new Blob([exportStylesFile()], { type: JSON_TYPE });
              downloadBytes(blob, `${EXPORT_NAME}${STYLE_FILE_SUFFIX}`);
              setMessage(t('stylePalette.exported'));
            }}
          />
          <label className="ui-button comment-styles-import">
            {t('stylePalette.import')}
            <input
              type="file"
              accept=".json,application/json"
              className="ui-visually-hidden"
              data-testid="comment-styles-import"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                void file
                  .text()
                  .then((text) => importStylesFile(text, uuidV4))
                  .then((r) => {
                    setMessage(
                      r.ok
                        ? t('stylePalette.imported', { count: r.count })
                        : t('stylePalette.importRefused', {
                            reasons: r.errors.map((er) => t(ERRORS[er])).join(' '),
                          }),
                    );
                  });
              }}
            />
          </label>
        </div>
        {full ? (
          <p className="comment-styles-note">{t('stylePalette.full', { max: MAX_STYLES })}</p>
        ) : null}
        <p className="comment-styles-message" role="status" data-testid="comment-styles-message">
          {message}
        </p>
      </div>
    </Dialog>
  );
}

function StyleRow({
  tool,
  style,
  first,
  last,
  renaming,
  onRename,
  onMessage,
}: {
  tool: StyleTool;
  style: UserStyle;
  first: boolean;
  last: boolean;
  renaming: boolean;
  onRename: (on: boolean) => void;
  onMessage: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(style.name);
  const nameRef = useRef<HTMLInputElement>(null);
  // The name field takes focus when renaming starts (rule 12).
  useEffect(() => {
    if (renaming) nameRef.current?.select();
  }, [renaming]);
  const named = { name: style.name };
  if (renaming)
    return (
      <li className="comment-styles-item">
        <StyleSwatch tool={tool} props={style.props} />
        <form
          className="comment-styles-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void renameStyle(tool, style.id, name).then((ok) => {
              if (ok) {
                onRename(false);
                onMessage(t('stylePalette.renamed', { name: name.trim() }));
              } else onMessage(t('stylePalette.badName', { max: MAX_NAME }));
            });
          }}
        >
          <TextField
            label={t('stylePalette.name')}
            value={name}
            maxLength={MAX_NAME}
            ref={nameRef}
            onChange={(e) => {
              setName(e.currentTarget.value);
            }}
          />
          <Button size="small" type="submit" label={t('stylePalette.save')} />
          <Button
            size="small"
            label={t('stylePalette.cancel')}
            onClick={() => {
              setName(style.name);
              onRename(false);
            }}
          />
        </form>
      </li>
    );
  return (
    <li className="comment-styles-item">
      <StyleSwatch tool={tool} props={style.props} />
      <span className="comment-styles-name">{style.name}</span>
      <span className="comment-styles-buttons">
        <Button
          size="small"
          label={t('stylePalette.rename')}
          aria-label={t('stylePalette.renameNamed', named)}
          onClick={() => {
            onRename(true);
          }}
        />
        <Button
          size="small"
          label={t('stylePalette.up')}
          aria-label={t('stylePalette.upNamed', named)}
          disabled={first}
          onClick={() => {
            void reorderStyle(tool, style.id, -1);
          }}
        />
        <Button
          size="small"
          label={t('stylePalette.down')}
          aria-label={t('stylePalette.downNamed', named)}
          disabled={last}
          onClick={() => {
            void reorderStyle(tool, style.id, 1);
          }}
        />
        <Button
          size="small"
          label={t('stylePalette.delete')}
          aria-label={t('stylePalette.deleteNamed', named)}
          onClick={() => {
            void deleteStyle(tool, style.id);
            onMessage(t('stylePalette.deleted', named));
          }}
        />
      </span>
    </li>
  );
}
