// Controls of the annotation Properties pane (M3-10). Each has a visible
// label (rule 12), commits once per change (one undo step each), and shows
// "Mixed" when the selection disagrees.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../../i18n';
import { ColorPicker } from '../../../ui/components';
import { parseLocaleNumber } from '../../../i18n/format';
import { MIXED, type Value } from './model';

export function ColorField({
  label,
  value,
  allowNone,
  noneLabel,
  disabled,
  onCommit,
}: {
  label: string;
  value: Value;
  /** A "No fill" entry in the picker (fill colours may be transparent). */
  allowNone?: boolean;
  /** The entry's name when it is not "No fill" (e.g. "No border"). */
  noneLabel?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  // The standard-colours picker (M6-16); "Mixed" is described on the button.
  return (
    <div className="prop-field prop-color">
      <label htmlFor={id}>{label}</label>
      <div className="prop-row">
        <ColorPicker
          id={id}
          label={label}
          value={value === MIXED ? null : typeof value === 'string' ? value : null}
          allowNone={allowNone ?? false}
          noneLabel={noneLabel ?? t('annotProps.noFill')}
          disabled={disabled ?? false}
          onChange={onCommit}
        />
        {value === MIXED ? (
          <span className="prop-mixed" aria-hidden="true">
            {t('annotProps.mixed')}
          </span>
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
  disabled?: boolean;
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
  disabled,
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
          disabled={disabled}
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
  disabled,
  onCommit,
}: {
  label: string;
  value: Value;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onCommit: (v: T) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="prop-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="ui-field-input prop-select"
        disabled={disabled}
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
  disabled?: boolean;
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
  disabled,
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
    disabled,
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

/** A yes/no property (a flag, bold, italic); "Mixed" shows as the indeterminate state. */
export function CheckField({
  label,
  value,
  disabled,
  describedBy,
  onCommit,
}: {
  label: string;
  value: Value;
  disabled?: boolean;
  describedBy?: string;
  onCommit: (v: boolean) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === MIXED;
  }, [value]);
  return (
    <div className="prop-field prop-flag">
      <label htmlFor={id}>{label}</label>
      <div className="prop-row">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="prop-checkbox"
          checked={value === true}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => {
            // From Mixed, a click turns the property on for all.
            onCommit(value === MIXED ? true : e.currentTarget.checked);
          }}
        />
      </div>
    </div>
  );
}

/** A value the user reads but does not change here (name, dates, author). */
export function InfoField({ label, value }: { label: string; value: string }) {
  const id = useId();
  return (
    <div className="prop-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="prop-info"
        readOnly
        value={value}
        title={value}
        aria-readonly="true"
      />
    </div>
  );
}
