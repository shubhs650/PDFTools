import { useEffect, useState } from 'react';
import { UiProvider } from '../ui/components';
import { AppFrame } from './AppFrame';
import { Backstage } from './backstage/Backstage';
import { registerBuiltinCommands } from './commands/builtins';
import { BOUNDARY } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import { ShortcutSheet } from './keys/ShortcutSheet';
import { useShortcuts } from './keys/useShortcuts';
import { QuickAccess } from './ribbon/QuickAccess';
import { Ribbon } from './ribbon/Ribbon';
import './app.css';

const focusDocument = (): void => {
  document.getElementById('document-panel')?.focus();
};

export function App() {
  const [backstage, setBackstage] = useState(false);
  useEffect(() => registerBuiltinCommands(), []);
  useShortcuts();
  return (
    <UiProvider>
      <ErrorBoundary where={BOUNDARY.app}>
        <AppFrame
          ribbon={
            <>
              <QuickAccess />
              <Ribbon
                onOpenBackstage={() => {
                  setBackstage(true);
                }}
                focusDocument={focusDocument}
              />
            </>
          }
        />
        <Backstage open={backstage} onOpenChange={setBackstage} />
        <ShortcutSheet />
      </ErrorBoundary>
    </UiProvider>
  );
}
