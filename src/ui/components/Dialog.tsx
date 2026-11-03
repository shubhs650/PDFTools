import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: the dialog's accessible name (rule 12). */
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  /** The close glyph (an icon from the registry). */
  closeIcon: ReactNode;
  /**
   * The control that takes focus when the dialog opens (default: the first
   * focusable one). A destructive confirmation points this at Cancel, so Enter
   * right after opening never deletes anything (preview review UI02).
   */
  initialFocus?: RefObject<HTMLElement | null>;
  /** An extra class on the dialog box (a wide window, M6-17). */
  className?: string;
  /** Esc pressed: preventDefault() keeps the dialog open (an inline edit cancels instead). */
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
}

/** Modal dialog: focus is trapped, Esc closes, focus returns to the opener (Radix). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeIcon,
  initialFocus,
  className,
  onEscapeKeyDown,
}: DialogProps) {
  const { t } = useTranslation();
  // Give focus back to whatever opened the dialog (rule 12). Radix only does
  // this for its own Trigger; our dialogs are opened by commands, shortcuts and
  // other components. onOpenAutoFocus runs before focus moves into the dialog.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-backdrop" />
        <RadixDialog.Content
          className={className ? `ui-dialog ${className}` : 'ui-dialog'}
          {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          onOpenAutoFocus={(e) => {
            const active = document.activeElement;
            returnTo.current = active instanceof HTMLElement ? active : null;
            const el = initialFocus?.current;
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            const el = returnTo.current;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <RadixDialog.Title className="ui-dialog-title">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="ui-dialog-description">
              {description}
            </RadixDialog.Description>
          ) : null}
          {children}
          {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
          <RadixDialog.Close asChild>
            <IconButton
              className="ui-dialog-close"
              label={t('ui.dialog.close')}
              icon={closeIcon}
              tooltip={false}
            />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
