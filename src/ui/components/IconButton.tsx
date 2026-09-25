import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClass } from './buttonClass';
import { Tooltip } from './Tooltip';

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label' | 'title'
>;

export interface IconButtonProps extends NativeButtonProps {
  /** Accessible name and tooltip text (rule 12). Pass a translated string (rule 11). */
  label: string;
  icon: ReactNode;
  variant?: 'default' | 'subtle' | undefined;
  size?: 'small' | 'medium' | undefined;
  /** Shows `label` as a tooltip on hover and focus (default true). */
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'subtle', size, className, tooltip = true, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={buttonClass(variant, size, `ui-button--icon ${className ?? ''}`.trim())}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});
