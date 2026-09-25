/** Class list for the shared button styles in ui.css. */
export function buttonClass(
  variant: 'default' | 'primary' | 'subtle' = 'default',
  size: 'small' | 'medium' = 'medium',
  extra = '',
): string {
  return [
    'ui-button',
    variant !== 'default' ? `ui-button--${variant}` : '',
    size === 'small' ? 'ui-button--small' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}
