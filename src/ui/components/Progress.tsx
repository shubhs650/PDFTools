export interface SpinnerProps {
  /** What is loading, announced to screen readers (rule 12). */
  label: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span role="status" className="ui-spinner-wrap">
      <span className="ui-spinner" aria-hidden="true" />
      <span className="ui-visually-hidden">{label}</span>
    </span>
  );
}

export interface ProgressBarProps {
  /** What is progressing (rule 12). */
  label: string;
  /** 0–1, or null when indeterminate. */
  value: number | null;
  /** Localized value text, e.g. format.percent(value) (rule 11). */
  valueText?: string;
}

export function ProgressBar({ label, value, valueText }: ProgressBarProps) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(pct === null ? {} : { 'aria-valuenow': pct })}
      {...(valueText ? { 'aria-valuetext': valueText } : {})}
      className="ui-progress"
    >
      <div className="ui-progress-bar" style={{ width: `${String(pct ?? 100)}%` }} />
    </div>
  );
}
