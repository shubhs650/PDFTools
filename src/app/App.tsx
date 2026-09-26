import { useEffect, useState } from 'react';
import { CloseDocumentDialog, OpenErrorDialog } from '../features/open/dialogs';
import { DocumentArea } from '../features/open/DocumentArea';
import { DropZone } from '../features/open/DropZone';
import { installLaunchQueue } from '../features/open/launchQueue';
import { startBackgroundPrecache, startOffline } from '../features/offline/offline';
import { OfflineStatus, UpdateWaitDialog } from '../features/offline/OfflineStatus';
import { installRecovery } from '../features/recovery/recovery';
import { RecoveryDialog } from '../features/recovery/RecoveryDialog';
import { registerSaveCommands } from '../features/save/commands';
import { GrowthPrompt, SaveOptimizedDialog } from '../features/save/SaveDialogs';
import { SaveErrorDialog, SaveStatus } from '../features/save/SaveStatus';
import { registerViewCommands } from '../features/view/commands';
import { PageNav, ViewModeSwitch, ZoomBox } from '../features/view/StatusControls';
import { UiProvider } from '../ui/components';
import { AppFrame } from './AppFrame';
import { Backstage } from './backstage/Backstage';
import { registerBuiltinCommands } from './commands/builtins';
import { registerCommand } from './commands/dispatch';
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
  // Open, and at which section (Help → Clear All Local Data opens Settings, M1-26).
  const [backstage, setBackstage] = useState<{ section?: string } | null>(null);
  useEffect(() => registerBuiltinCommands(), []);
  useEffect(
    () =>
      registerCommand('help.clearData', {
        run: () => {
          setBackstage({ section: 'file.settings' });
        },
      }),
    [],
  );
  useEffect(() => registerViewCommands(), []);
  useEffect(() => registerSaveCommands(), []);
  useEffect(() => installRecovery(), []);
  // §9: register the service worker; after the first render, precache the rest.
  useEffect(() => {
    void startOffline().then(() => {
      setTimeout(() => {
        void startBackgroundPrecache();
      }, 1000);
    });
  }, []);
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
            app: (
              <>
                <SaveStatus />
                <OfflineStatus />
              </>
            ),
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
                  setBackstage({});
                }}
                focusDocument={focusDocument}
              />
            </>
          }
        >
          <DocumentArea />
        </AppFrame>
        <Backstage
          open={backstage !== null}
          {...(backstage?.section ? { section: backstage.section } : {})}
          onOpenChange={(open) => {
            setBackstage(open ? {} : null);
          }}
        />
        <ShortcutSheet />
        <CloseDocumentDialog />
        <OpenErrorDialog />
        <SaveErrorDialog />
        <SaveOptimizedDialog />
        <GrowthPrompt />
        <RecoveryDialog />
        <UpdateWaitDialog />
        <DropZone />
      </ErrorBoundary>
    </UiProvider>
  );
}
