import { useEffect, useState } from 'react';
import { CloseDocumentDialog, OpenErrorDialog } from '../features/open/dialogs';
import { DocumentArea } from '../features/open/DocumentArea';
import { DropZone } from '../features/open/DropZone';
import { installLaunchQueue } from '../features/open/launchQueue';
import { registerViewCommands } from '../features/view/commands';
import { PageNav, ViewModeSwitch, ZoomBox } from '../features/view/StatusControls';
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
  useEffect(() => registerViewCommands(), []);
  // After the commands exist: launched files open like any other (M1-19).
  useEffect(() => {
    installLaunchQueue();
  }, []);
  useShortcuts();
  return (
    <UiProvider>
      <ErrorBoundary where={BOUNDARY.app}>
        <AppFrame
          status={{
            pageNav: <PageNav />,
            view: (
              <>
                <ViewModeSwitch />
                <ZoomBox />
              </>
            ),
          }}
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
        >
          <DocumentArea />
        </AppFrame>
        <Backstage open={backstage} onOpenChange={setBackstage} />
        <ShortcutSheet />
        <CloseDocumentDialog />
        <OpenErrorDialog />
        <DropZone />
      </ErrorBoundary>
    </UiProvider>
  );
}
