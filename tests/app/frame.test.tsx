// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../src/i18n';
import { diagnostics } from '../../src/app/diagnostics';
import { ErrorBoundary } from '../../src/app/ErrorBoundary';
import { TabStrip } from '../../src/app/TabStrip';
import { documentStore, useDocuments } from '../../src/app/store/documentStore';
import { UiProvider } from '../../src/ui/components';

afterEach(cleanup);
beforeEach(() => {
  for (const id of documentStore.getState().order) documentStore.getState().close(id);
});

const meta = (id: string) => ({
  id,
  name: `${id}.pdf`,
  pageCount: 1,
  permissions: -1,
  signatureCount: 0,
});

describe('selectors (no whole-store re-renders)', () => {
  it('a reader of the tab order does not re-render when view state changes', () => {
    let renders = 0;
    function OrderReader() {
      renders++;
      const order = useDocuments((s) => s.order);
      return <span>{order.length}</span>;
    }
    act(() => {
      documentStore.getState().open(meta('a'));
    });
    render(<OrderReader />);
    const before = renders;
    act(() => {
      documentStore.getState().setView('a', { page: 3 });
      documentStore.getState().setView('a', { zoom: 2 });
    });
    expect(renders).toBe(before);
    act(() => {
      documentStore.getState().open(meta('b'));
    });
    expect(renders).toBe(before + 1);
  });
});

describe('ErrorBoundary (rule 10)', () => {
  it('shows a localized message, records only code and stack, and Reload remounts', async () => {
    let fail = true;
    function Flaky() {
      const [n] = useState(0);
      if (fail) throw new Error('secret text from page 12 of Q3-budget.pdf');
      return <span data-testid="ok">{n}</span>;
    }
    const quiet = console.error;
    console.error = () => undefined; // React logs caught errors; expected here
    try {
      render(
        <UiProvider>
          <ErrorBoundary where="document">
            <Flaky />
          </ErrorBoundary>
        </UiProvider>,
      );
    } finally {
      console.error = quiet;
    }
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    const entry = diagnostics().at(-1);
    expect(entry).toMatchObject({ code: 'internal', message: 'Error', where: 'document' });
    expect(JSON.stringify(entry)).not.toMatch(/secret|budget/);

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByTestId('ok')).toBeTruthy();
  });
});

describe('TabStrip', () => {
  it('renders nothing focusable without documents', () => {
    render(<TabStrip />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('is a tablist with roving focus; arrows activate; close buttons are named', async () => {
    act(() => {
      for (const id of ['a', 'b', 'c']) documentStore.getState().open(meta(id));
      documentStore.getState().activate('a');
      documentStore.getState().markDirty('b');
    });
    render(
      <UiProvider>
        <TabStrip />
      </UiProvider>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(screen.getByRole('tab', { name: 'b.pdf, unsaved changes' })).toBeTruthy();
    tabs[0]?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(documentStore.getState().activeId).toBe('b');
    expect(document.activeElement?.id).toBe('tab-b');
    await userEvent.keyboard('{End}');
    expect(documentStore.getState().activeId).toBe('c');
    await userEvent.keyboard('{ArrowRight}');
    expect(documentStore.getState().activeId).toBe('a'); // wraps
    await userEvent.click(screen.getByRole('button', { name: 'Close c.pdf' }));
    expect(documentStore.getState().order).toEqual(['a', 'b']);
  });
});
