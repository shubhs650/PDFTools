// Component gallery for e2e tests (M1-05): every UI primitive in its states.
// Built only in `--mode e2e` (main.tsx), never shipped.
//
// The strings below are test fixtures, not product copy, so they are kept out
// of en.json (which ships) on purpose.
/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Save20Filled, Save20Regular } from '@fluentui/react-icons/svg/save';
import {
  Button,
  Dialog,
  DropdownMenu,
  IconButton,
  ProgressBar,
  Spinner,
  SplitButton,
  ToggleButton,
  UiProvider,
} from '../ui/components';

const G = {
  title: 'UI gallery',
  primary: 'Primary action',
  normal: 'Default action',
  disabled: 'Disabled action',
  save: 'Save',
  toggle: 'Toggle snapping',
  split: 'Save as',
  splitA: 'Save a copy',
  splitB: 'Save optimized',
  menu: 'Open menu',
  menuA: 'First item',
  menuB: 'Disabled item',
  dialog: 'Open dialog',
  dialogTitle: 'Example dialog',
  dialogBody: 'Dialogs trap focus and close with Esc.',
  ok: 'OK',
  loading: 'Loading document',
  progress: 'Saving',
};

export function Gallery() {
  const [pressed, setPressed] = useState(false);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => {
    setLog((l) => [...l, s]);
  };
  return (
    <UiProvider>
      <main aria-label={G.title} data-testid="gallery" style={{ padding: 'var(--space-6)' }}>
        <h1>{G.title}</h1>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Button
            label={G.primary}
            variant="primary"
            onClick={() => {
              note('primary');
            }}
          />
          <Button
            label={G.normal}
            icon={<Save20Regular />}
            onClick={() => {
              note('default');
            }}
          />
          <Button
            label={G.disabled}
            disabled
            onClick={() => {
              note('disabled');
            }}
          />
          <IconButton
            label={G.save}
            icon={<Save20Regular />}
            onClick={() => {
              note('icon');
            }}
          />
          <ToggleButton
            label={G.toggle}
            iconOnly
            icon={<Save20Regular />}
            pressedIcon={<Save20Filled />}
            pressed={pressed}
            onPressedChange={setPressed}
          />
          <SplitButton
            label={G.split}
            onClick={() => {
              note('split');
            }}
            menuIcon={<ChevronDown20Regular />}
            entries={[
              {
                id: 'a',
                label: G.splitA,
                onSelect: () => {
                  note('splitA');
                },
              },
              {
                id: 'b',
                label: G.splitB,
                onSelect: () => {
                  note('splitB');
                },
              },
            ]}
          />
          <DropdownMenu
            trigger={<Button label={G.menu} />}
            entries={[
              {
                id: 'a',
                label: G.menuA,
                onSelect: () => {
                  note('menuA');
                },
              },
              { kind: 'separator', id: 's' },
              {
                id: 'b',
                label: G.menuB,
                disabled: true,
                onSelect: () => {
                  note('menuB');
                },
              },
            ]}
          />
          <Button
            label={G.dialog}
            onClick={() => {
              setOpen(true);
            }}
          />
        </div>
        <div style={{ marginTop: 'var(--space-6)', display: 'grid', gap: 'var(--space-3)' }}>
          <Spinner label={G.loading} />
          <ProgressBar label={G.progress} value={0.4} valueText="40%" />
        </div>
        <output data-testid="log">{log.join(',')}</output>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={G.dialogTitle}
          description={G.dialogBody}
          closeIcon={<Dismiss20Regular />}
          footer={
            <Button
              label={G.ok}
              variant="primary"
              onClick={() => {
                setOpen(false);
              }}
            />
          }
        />
      </main>
    </UiProvider>
  );
}
