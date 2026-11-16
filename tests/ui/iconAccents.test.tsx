// @vitest-environment jsdom
// M10-08·O1 (ADR-027 D-47, review R16): a second icon colour on a few key tools.
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/app/commands';
import { CommandIcon } from '../../src/ui/icons/CommandIcon';
import { ICON_ACCENT_ROLES, ICON_ACCENTS, iconAccentFor } from '../../src/ui/icons/accents';

afterEach(cleanup);

const ids = new Set(COMMANDS.map((c) => c.id));
const appCss = readFileSync('src/app/app.css', 'utf8');
const uiCss = readFileSync('src/ui/components/ui.css', 'utf8');
const tokens = readFileSync('src/ui/tokens.css', 'utf8');

describe('icon accents (M10-08·O1)', () => {
  it('names only real commands, and stays a handful (landmarks, not decoration)', () => {
    const accented = Object.keys(ICON_ACCENTS);
    expect(accented.filter((id) => !ids.has(id))).toEqual([]);
    expect(accented.length).toBeGreaterThan(0);
    expect(accented.length).toBeLessThanOrEqual(12);
  });

  it('uses every role, each with a token and a ribbon and menu rule', () => {
    expect(new Set(Object.values(ICON_ACCENTS))).toEqual(new Set(ICON_ACCENT_ROLES));
    for (const h of ICON_ACCENT_ROLES) {
      expect(tokens).toContain(`--color-icon-${h}:`);
      expect(appCss).toContain(
        `.ribbon-button:not([aria-disabled='true']) .ribbon-icon[data-icon-accent='${h}'] {\n  color: var(--color-icon-${h});`,
      );
      expect(uiCss).toContain(
        `.ui-menu-item:not([data-disabled]) [data-icon-accent='${h}'] {\n  color: var(--color-icon-${h});`,
      );
    }
  });

  it('marks an accented icon at rest, and drops the accent while pressed', () => {
    expect(iconAccentFor('comment.highlight')).toBe('markup');
    expect(iconAccentFor('comment.highlight', true)).toBeUndefined();
    expect(iconAccentFor('home.hand')).toBeUndefined();

    const { container, rerender } = render(<CommandIcon id="protect.markRedaction" large />);
    const svg = () => container.querySelector('svg');
    expect(svg()?.getAttribute('data-icon-accent')).toBe('redact');
    expect(svg()?.getAttribute('aria-hidden')).toBe('true');
    rerender(<CommandIcon id="protect.markRedaction" large pressed />);
    expect(svg()?.hasAttribute('data-icon-accent')).toBe(false);
    rerender(<CommandIcon id="home.hand" />);
    expect(svg()?.hasAttribute('data-icon-accent')).toBe(false);
  });
});
