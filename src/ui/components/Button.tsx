import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClass } from './buttonClass';

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>;

export interface ButtonProps extends NativeButtonProps {
  /** Visible text and accessible name (rule 12). Pass a translated string (rule 11). */
  label: string;
  icon?: ReactNode;
  variant?: 'default' | 'primary' | 'subtle' | undefined;
  size?: 'small' | 'medium' | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { label, icon, variant, size, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
});
