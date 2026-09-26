import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'aria-label' | 'aria-invalid' | 'aria-describedby'
>;

export interface TextFieldProps extends NativeInputProps {
  /** Visible label and accessible name (rules 11 and 12). */
  label: string;
  /** Shown under the field and announced; marks the field invalid. */
  error?: string | undefined;
}

/** A labelled text input with an optional, announced error message. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, className, type = 'text', ...rest },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={['ui-field', className].filter(Boolean).join(' ')}>
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        className="ui-field-input"
        {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="ui-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
