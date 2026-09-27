import { lazy, Suspense, useEffect, useState } from 'react';
import { CloseDocumentDialog, OpenErrorDialog } from '../features/open/dialogs';
import { DocumentArea } from '../features/open/DocumentArea';
import { DropZone } from '../features/open/DropZone';
import { installLaunchQueue } from '../features/open/launchQueue';
import { startBackgroundPrecache, startOffline } from '../features/offline/offline';
import { OfflineStatus, UpdateWaitDialog } from '../features/offline/OfflineStatus';
import { installRecovery } from '../features/recovery/recovery';
import { registerFormCommands } from '../features/forms/commands';
import { registerPrintCommands } from '../features/print/commands';
import { PrintDialog } from '../features/print/PrintDialog';
import { PrintReadyDialog } from '../features/print/PrintReadyDialog';
import { HelpPage } from '../features/help/HelpPage';
import { registerReportCommands } from '../features/report/commands';
import { ReportDialog } from '../features/report/ReportDialog';
import { ResetFormDialog } from '../features/forms/ResetFormDialog';
import { registerProtectCommands } from '../features/protect/commands';
import { PasswordDialog } from '../features/protect/PasswordDialog';
import { SecurityInfoDialog } from '../features/protect/SecurityInfo';
import { UnlockDialog } from '../features/protect/UnlockDialog';
import { ExternalLinkDialog } from '../features/view/ExternalLinkDialog';
import { RecoveryDialog } from '../features/recovery/RecoveryDialog';
import { registerSaveCommands } from '../features/save/commands';
import { registerFindCommands } from '../features/search/commands';
import { registerSelectionCommands } from '../features/select/commands';
import { registerAnnotateCommands } from '../features/annotate/commands';
import { ProfileDialog } from '../features/settings/profile/ProfileDialog';
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

// e2e builds only (M1-Q3): a component that throws on request (M2-17 tests).
// Statically null elsewhere, so the import is dropped from production builds.
const CrashProbe =
  import.meta.env.MODE === 'e2e' ? lazy(() => import('../testing/CrashProbe')) : null;

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
  useEffect(() => registerProtectCommands(), []);
  useEffect(() => registerFormCommands(), []);
  useEffect(() => registerPrintCommands(), []);
  useEffect(() => registerReportCommands(), []);
  useEffect(() => registerSelectionCommands(), []);
  useEffect(() => registerAnnotateCommands(), []);
  useEffect(() => registerFindCommands(), []);
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
        <PasswordDialog />
        <UnlockDialog />
        <SecurityInfoDialog />
        <ResetFormDialog />
        <PrintDialog />
        <PrintReadyDialog />
        <ExternalLinkDialog />
        <SaveErrorDialog />
        <SaveOptimizedDialog />
        <GrowthPrompt />
        <RecoveryDialog />
        <ProfileDialog />
        <UpdateWaitDialog />
        <DropZone />
        <HelpPage />
        {CrashProbe ? (
          <Suspense fallback={null}>
            <CrashProbe />
          </Suspense>
        ) : null}
      </ErrorBoundary>
      {/* Outside the boundary: its report offer must work while the app is down. */}
      <ReportDialog />
    </UiProvider>
  );
}
