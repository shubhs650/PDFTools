// Controls of the annotation Properties pane (M3-10). Each has a visible
// label (rule 12), commits once per change (one undo step each), and shows
// "Mixed" when the selection disagrees.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../../i18n';
import { parseLocaleNumber } from '../../../i18n/format';
import { MIXED, type Value } from './model';

const HEX = /^#[0-9a-f]{6}$/iu;

export function ColorField({
  label,
  value,
  allowNone,
  onCommit,
}: {
  label: string;
  value: Value;
  /** A "No fill" checkbox (fill colours may be transparent). */
  allowNone?: boolean;
  onCommit: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const none = value === 'transparent';
  const hex = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : '#000000';
  // The native "change" fires once the picker closes: one commit, one undo step.
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (): void => {
      commit.current(el.value);
    };
    el.addEventListener('change', on);
    return () => {
      el.removeEventListener('change', on);
    };
  }, []);
  return (
    <div className="prop-field prop-color">
      <label htmlFor={id}>{label}</label>
      <div className="prop-row">
        <input
          ref={ref}
          id={id}
          type="color"
          className="prop-swatch ui-focusable"
          defaultValue={hex}
          key={hex}
          disabled={none}
          aria-describedby={value === MIXED ? `${id}-mixed` : undefined}
        />
        {value === MIXED ? (
          <span id={`${id}-mixed`} className="prop-mixed">
            {t('annotProps.mixed')}
          </span>
        ) : null}
        {allowNone ? (
          <label className="prop-check">
            <input
              type="checkbox"
              checked={none}
              onChange={(e) => {
                onCommit(e.currentTarget.checked ? 'transparent' : '#ffffff');
              }}
            />
            {t('annotProps.noFill')}
          </label>
        ) : null}
      </div>
    </div>
  );
}

interface NumberProps {
  label: string;
  value: Value;
  unit: string;
  min: number;
  max: number;
  digits?: number;
  onCommit: (v: number) => void;
}

/** A number typed in the user's locale (Intl), committed on Enter or leaving the field. */
export function NumberField(props: NumberProps) {
  const shown =
    typeof props.value === 'number' ? format.number(props.value, props.digits ?? 0) : '';
  // A new value from the selection starts the field afresh.
  return <NumberInput key={`${shown}|${String(props.value === MIXED)}`} {...props} shown={shown} />;
}

function NumberInput({
  label,
  value,
  unit,
  min,
  max,
  digits = 0,
  onCommit,
  shown,
}: NumberProps & { shown: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  const commit = (): void => {
    if (text.trim() === '' || text === shown) return;
    const n = parseLocaleNumber(text, format.locale);
    if (n === null || n < min || n > max) {
      setError(true);
      return;
    }
    setError(false);
    onCommit(n);
  };
  return (
    <div className="prop-field">
      <label htmlFor={id}>{label}</label>
      <div className="prop-row">
        <input
          id={id}
          className="ui-field-input prop-number"
          inputMode="decimal"
          value={text}
          placeholder={value === MIXED ? t('annotProps.mixed') : undefined}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <span className="prop-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="ui-field-error" role="alert">
          {t('annotProps.range', {
            min: format.number(min, digits),
            max: format.number(max, digits),
          })}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: Value;
  options: readonly { value: T; label: string }[];
  onCommit: (v: T) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="prop-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="ui-field-input"
        value={value === MIXED ? '' : String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.currentTarget.value);
          if (o) onCommit(o.value);
        }}
      >
        {value === MIXED ? (
          <option value="" disabled>
            {t('annotProps.mixed')}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextPropProps {
  label: string;
  value: Value;
  multiline?: boolean;
  onCommit: (v: string) => void;
}

/** Text committed when leaving the field (subject, contents). */
export function TextProp(props: TextPropProps) {
  const shown = typeof props.value === 'string' ? props.value : '';
  return <TextInput key={`${shown}|${String(props.value === MIXED)}`} {...props} shown={shown} />;
}

function TextInput({
  label,
  value,
  multiline,
  onCommit,
  shown,
}: TextPropProps & { shown: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(shown);
  const props = {
    id,
    className: 'ui-field-input prop-text',
    value: text,
    placeholder: value === MIXED ? t('annotProps.mixed') : undefined,
    onBlur: () => {
      if (text !== shown) onCommit(text);
    },
  };
  return (
    <div className="prop-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...props}
          rows={4}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
        />
      ) : (
        <input
          {...props}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
        />
      )}
    </div>
  );
}
