// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/i18n';
import { ColorPicker, NO_COLOR, UiProvider } from '../../src/ui/components';

afterEach(cleanup);

function Harness({
  start,
  allowNone,
  onChange,
}: {
  start: string | null;
  allowNone?: boolean;
  onChange: (v: string) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <UiProvider>
      <ColorPicker
        label="Stroke color"
        value={value}
        allowNone={allowNone ?? false}
        noneLabel="No fill"
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </UiProvider>
  );
}

describe('ColorPicker (M6-16)', () => {
  it('names the button and describes its colour', () => {
    render(<Harness start="#FF0000" onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Stroke color' });
    expect(
      document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Red');
  });

  it('describes a custom colour by RGB and a mixed selection as Mixed', () => {
    const { unmount } = render(<Harness start="#123456" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Stroke color' }).title).toBe('RGB: 18, 52, 86');
    unmount();
    render(<Harness start={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Stroke color' }).title).toBe('Mixed');
  });

  it('opens the standard colours, marks the current one, and picks with a click', async () => {
    const onChange = vi.fn();
    render(<Harness start="#ff0000" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stroke color' }));
    const popup = screen.getByRole('dialog', { name: 'Stroke color' });
    const grid = within(popup).getByRole('group', { name: 'Standard colors' });
    expect(within(grid).getAllByRole('button')).toHaveLength(48);
    const red = within(grid).getByRole('button', { name: 'Red' });
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(red);
    await userEvent.click(within(grid).getByRole('button', { name: 'Blue' }));
    expect(onChange).toHaveBeenCalledWith('#0000ff');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves with the arrow keys and picks with Enter', async () => {
    const onChange = vi.fn();
    render(<Harness start="#ff0000" onChange={onChange} />);
    screen.getByRole('button', { name: 'Stroke color' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Red');
    await userEvent.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pale orange');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('#ffe5cc');
  });

  it('picking the current colour again commits nothing', async () => {
    const onChange = vi.fn();
    render(<Harness start="#ff0000" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stroke color' }));
    await userEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers "No fill" only when allowed', async () => {
    const onChange = vi.fn();
    const { unmount } = render(<Harness start="#ff0000" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stroke color' }));
    expect(screen.queryByRole('button', { name: 'No fill' })).toBeNull();
    unmount();
    render(<Harness start="#ff0000" allowNone onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stroke color' }));
    await userEvent.click(screen.getByRole('button', { name: 'No fill' }));
    expect(onChange).toHaveBeenCalledWith(NO_COLOR);
  });

  it('"More colors…" hands over to the system picker, committing its change once', async () => {
    const onChange = vi.fn();
    render(<Harness start="#ff0000" onChange={onChange} />);
    const native = document.querySelector<HTMLInputElement>('input[type="color"]');
    if (!native) throw new Error('no native input');
    const shown = vi.fn();
    native.showPicker = shown;
    await userEvent.click(screen.getByRole('button', { name: 'Stroke color' }));
    await userEvent.click(screen.getByRole('button', { name: 'More colors…' }));
    expect(shown).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    native.value = '#123456';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#123456');
  });

  it('is disabled with its field', () => {
    render(
      <UiProvider>
        <ColorPicker label="Fill color" value="#ff0000" disabled onChange={vi.fn()} />
      </UiProvider>,
    );
    expect(screen.getByRole('button', { name: 'Fill color' })).toHaveProperty('disabled', true);
  });
});
