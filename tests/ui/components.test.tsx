// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/i18n';
import {
  Button,
  IconButton,
  ProgressBar,
  Spinner,
  ToggleButton,
  UiProvider,
} from '../../src/ui/components';

afterEach(cleanup);

const Icon = () => <svg data-testid="icon" />;

describe('accessible names are required (rule 12)', () => {
  it('rejects primitives without a label at compile time', () => {
    // @ts-expect-error label is required
    const a = <Button onClick={() => undefined} />;
    // @ts-expect-error label is required
    const b = <IconButton icon={<Icon />} />;
    // @ts-expect-error label is required
    const c = <Spinner />;
    expect([a, b, c]).toHaveLength(3);
  });
});

describe('Button', () => {
  it('has its label as name and fires on keyboard activation', async () => {
    const onClick = vi.fn();
    render(<Button label="Save" icon={<Icon />} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
    btn.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is disabled natively and never fires', async () => {
    const onClick = vi.fn();
    render(<Button label="Save" disabled onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('uses the label as accessible name and hides the icon', () => {
    render(
      <UiProvider>
        <IconButton label="Close tab" icon={<Icon />} />
      </UiProvider>,
    );
    const btn = screen.getByRole('button', { name: 'Close tab' });
    expect(btn.textContent).toBe('');
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ToggleButton', () => {
  function Harness() {
    const [pressed, setPressed] = useState(false);
    return (
      <UiProvider>
        <ToggleButton
          label="Enable snapping"
          iconOnly
          icon={<svg data-testid="regular" />}
          pressedIcon={<svg data-testid="filled" />}
          pressed={pressed}
          onPressedChange={setPressed}
        />
      </UiProvider>
    );
  }

  it('toggles aria-pressed from the keyboard and swaps to the Filled icon', async () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Enable snapping' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.focus();
    await userEvent.keyboard(' ');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('filled')).toBeTruthy();
  });
});

describe('progress', () => {
  it('Spinner is a named status', () => {
    render(<Spinner label="Loading document" />);
    expect(screen.getByRole('status').textContent).toBe('Loading document');
  });

  it('ProgressBar exposes value, clamps it, and supports indeterminate', () => {
    const { rerender } = render(<ProgressBar label="Saving" value={0.426} valueText="43 %" />);
    const bar = screen.getByRole('progressbar', { name: 'Saving' });
    expect(bar.getAttribute('aria-valuenow')).toBe('43');
    expect(bar.getAttribute('aria-valuetext')).toBe('43 %');
    rerender(<ProgressBar label="Saving" value={2} />);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    rerender(<ProgressBar label="Saving" value={null} />);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });
});
