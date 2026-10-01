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
import { registerExtractCommands } from '../features/extract/commands';
import { registerTableCommands } from '../features/tables/commands';
import { registerRedactCommands } from '../features/redact/commands';
import { RedactionStatus } from '../features/redact/PendingRedactionsPanel';
import { ApplyDialog } from '../features/redact/ApplyDialog';
import { ExpressExtractDialog } from '../features/tables/ExpressExtractDialog';
import { TemplatesDialog } from '../features/tables/TemplatesDialog';
import { registerPageCommands } from '../features/pages/commands';
import { PageDialogs } from '../features/pages/PageDialogs';
import { FileDialogs } from '../features/pages/FileDialogs';
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
import { ContentsDialog } from '../features/annotate/tools/ContentsDialog';
import { LinkEditDialog } from '../features/annotate/tools/LinkEditDialog';
import { DeleteThreadDialog } from '../features/annotate/comments/DeleteThreadDialog';
import { SchemesDialog } from '../features/stamps/schemes/SchemesDialog';
import { ImageStampDialog, StampDialog } from '../features/stamps/StampDialogs';
import { CalibrateDialog, SetScaleDialog } from '../features/measure/ScaleDialogs';
import { ViewportDialog } from '../features/measure/ViewportDialog';
import { SnapStatus } from '../features/measure/SnapStatus';
import { CrsDialog } from '../features/crs/CrsDialog';
import { AnnotationExportDialog } from '../features/annotate/export/AnnotationExportDialog';
import { ImportCommentsDialog } from '../features/annotate/transfer/ImportCommentsDialog';
import { ExportDialog } from '../features/extract/ExportDialog';
import { ScaleIndicator } from '../features/measure/ScaleIndicator';
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
  useEffect(() => registerExtractCommands(), []);
  useEffect(() => registerTableCommands(), []);
  useEffect(() => registerRedactCommands(), []);
  useEffect(() => registerPageCommands(), []);
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
                <RedactionStatus />
                <OfflineStatus />
              </>
            ),
            pageNav: <PageNav />,
            view: (
              <>
                <SnapStatus />
                <ScaleIndicator />
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
        <ContentsDialog />
        <LinkEditDialog />
        <DeleteThreadDialog />
        <SchemesDialog />
        <StampDialog />
        <ImageStampDialog />
        <SetScaleDialog />
        <CalibrateDialog />
        <ViewportDialog />
        <CrsDialog />
        <AnnotationExportDialog />
        <ImportCommentsDialog />
        <ExportDialog />
        <ExpressExtractDialog />
        <TemplatesDialog />
        <ApplyDialog />
        <PageDialogs />
        <FileDialogs />
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
