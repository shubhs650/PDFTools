import { CloseComparisonDialog } from '../features/compare/file/CloseComparisonDialog';
import { lazy, Suspense, useEffect, useState } from 'react';
import { followPanes } from './panePlace';
import { CloseDocumentDialog, OpenErrorDialog } from '../features/open/dialogs';
import { DocumentArea } from '../features/open/DocumentArea';
import { DropZone } from '../features/open/DropZone';
import { installLaunchQueue } from '../features/open/launchQueue';
import { startBackgroundPrecache, startOffline } from '../features/offline/offline';
import { OfflineStatus, UpdateWaitDialog } from '../features/offline/OfflineStatus';
import { ToolHint } from '../features/annotate/tools/ToolHint';
import { installRecovery } from '../features/recovery/recovery';
import { installLastViews } from '../features/view/lastView';
import { installSession } from '../features/session/session';
import { registerFormCommands } from '../features/forms/commands';
import { registerPrintCommands } from '../features/print/commands';
import { registerExtractCommands } from '../features/extract/commands';
import { registerTableCommands } from '../features/tables/commands';
import { registerRedactCommands } from '../features/redact/commands';
import { registerSnapshotCommands } from '../features/snapshot/snapshot';
import { registerPageImageCommands } from '../features/pageImage/pageImage';
import { PageImageProgress } from '../features/pageImage/PageImageProgress';
import { registerAttachFileCommands } from '../features/attachments/attachFile';
import { registerSignCommands } from '../features/sign/signDocument';
import { SignDocumentDialog } from '../features/sign/SignDocumentDialog';
import { SnapshotToast } from '../features/snapshot/SnapshotLayer';
import { MeasureLoupe } from '../features/measure/MeasureLoupe';
import { registerOcrCommands } from '../features/ocr/commands';
import { OcrDialog } from '../features/ocr/OcrDialog';
import { RedactionStatus } from '../features/redact/PendingRedactionsPanel';
import { ApplyDialog } from '../features/redact/ApplyDialog';
import { ExpressExtractDialog } from '../features/tables/ExpressExtractDialog';
import { TemplatesDialog } from '../features/tables/TemplatesDialog';
import { registerPageCommands } from '../features/pages/commands';
import { PageDialogs } from '../features/pages/PageDialogs';
import { registerCropCommands } from '../features/pages/crop';
import { registerBookmarkCommands } from '../features/bookmarks/commands';
import { BookmarkPropertiesDialog } from '../features/bookmarks/BookmarkPropertiesDialog';
import { FileDialogs } from '../features/pages/FileDialogs';
import { PrintDialog } from '../features/print/PrintDialog';
import { PrintReadyDialog } from '../features/print/PrintReadyDialog';
import { ExportOverlayDialog } from '../features/compare/overlay/ExportOverlayDialog';
import { RegisterDialog } from '../features/compare/register/RegisterDialog';
import { SavePresetDialog } from '../features/compare/presets/SavePresetDialog';
import {
  RebuildComparisonDialog,
  SaveComparisonDialog,
} from '../features/compare/file/SaveComparisonDialog';
import { registerReportCommands } from '../features/report/commands';
import { ReportDialog } from '../features/report/ReportDialog';
import { ResetFormDialog } from '../features/forms/ResetFormDialog';
import { registerProtectCommands } from '../features/protect/commands';
import { PasswordDialog } from '../features/protect/PasswordDialog';
import { SecurityInfoDialog } from '../features/protect/SecurityInfo';
import { UnlockDialog } from '../features/protect/UnlockDialog';
import { PasswordSecurityDialog } from '../features/protect/PasswordSecurityDialog';
import { ExternalLinkDialog } from '../features/view/ExternalLinkDialog';
import { TellMe } from '../features/tellMe/TellMe';
import { WhatsNewBanner } from '../features/whatsNew/WhatsNew';
import { startWhatsNew } from '../features/whatsNew/releases';
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
import { CommentStylesDialog } from '../features/annotate/palette/CommentStylesDialog';
import { ImageStampDialog, StampDialog } from '../features/stamps/StampDialogs';
import { CalibrateDialog, SetScaleDialog } from '../features/measure/ScaleDialogs';
import { ViewportDialog } from '../features/measure/ViewportDialog';
import { SnapStatus } from '../features/measure/SnapStatus';
import { ThinLinesStatus } from '../features/view/ThinLinesStatus';
import { CrsDialog } from '../features/crs/CrsDialog';
import { MeasureExportDialog } from '../features/measure/export/MeasureExportDialog';
import { TemplateManager } from '../features/crs/templates/TemplateManager';
import { TemplateSetup } from '../features/crs/templates/TemplateSetup';
import { AnnotationExportDialog } from '../features/annotate/export/AnnotationExportDialog';
import { ImportCommentsDialog } from '../features/annotate/transfer/ImportCommentsDialog';
import { FlattenDialog } from '../features/annotate/flatten/FlattenDialog';
import { ExportDialog } from '../features/extract/ExportDialog';
import { ScaleIndicator } from '../features/measure/ScaleIndicator';
import { GrowthPrompt, SaveOptimizedDialog } from '../features/save/SaveDialogs';
import { SaveErrorDialog, SaveStatus } from '../features/save/SaveStatus';
import { registerViewCommands } from '../features/view/commands';
import {
  PageNav,
  StatusDivider,
  ViewHistoryNav,
  ViewModeSwitch,
  ZoomBox,
} from '../features/view/StatusControls';
import { UiProvider } from '../ui/components';
import { AppFrame } from './AppFrame';
import { Backstage } from './backstage/Backstage';
import { registerBuiltinCommands } from './commands/builtins';
import { registerTabCommands } from './tabCommands';
import { registerCompareCommands } from '../features/compare/commands';
import { RenameFileDialog } from './RenameFileDialog';
import { registerCommand } from './commands/dispatch';
import { BOUNDARY } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import { ShortcutSheet } from './keys/ShortcutSheet';
import { useShortcuts } from './keys/useShortcuts';
import { Ribbon } from './ribbon/Ribbon';
import './app.css';

/** File's entries that are pages of the backstage rather than actions. */
const BACKSTAGE_PAGES = [
  'file.recent',
  'file.properties',
  'file.settings',
  'file.about',
  'file.privacy',
] as const;

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
  useEffect(() => registerTabCommands(), []);
  useEffect(() => registerCompareCommands(), []);
  // A side pane shown, hidden or resized keeps the document's place (M11-10).
  useEffect(() => followPanes(), []);
  useEffect(
    () =>
      registerCommand('help.clearData', {
        run: () => {
          setBackstage({ section: 'file.settings' });
        },
      }),
    [],
  );
  // File's pages (Recent, Properties, Settings, About, Privacy) as commands, so Tell me
  // (M10-08·O2) can open the backstage at them; the backstage itself shows them as pages.
  useEffect(() => {
    const offs = BACKSTAGE_PAGES.map((id) =>
      registerCommand(id, {
        run: () => {
          setBackstage({ section: id });
        },
      }),
    );
    return () => {
      for (const off of offs) off();
    };
  }, []);
  useEffect(() => registerViewCommands(), []);
  useEffect(() => registerSaveCommands(), []);
  useEffect(() => registerProtectCommands(), []);
  useEffect(() => registerFormCommands(), []);
  useEffect(() => registerPrintCommands(), []);
  useEffect(() => registerExtractCommands(), []);
  useEffect(() => registerTableCommands(), []);
  useEffect(() => registerRedactCommands(), []);
  useEffect(() => registerSnapshotCommands(), []);
  useEffect(() => registerPageImageCommands(), []);
  useEffect(() => registerAttachFileCommands(), []);
  useEffect(() => registerSignCommands(), []);
  useEffect(() => registerBookmarkCommands(), []);
  useEffect(() => registerOcrCommands(), []);
  useEffect(() => registerPageCommands(), []);
  useEffect(() => registerCropCommands(), []);
  useEffect(() => registerReportCommands(), []);
  useEffect(() => registerSelectionCommands(), []);
  useEffect(() => registerAnnotateCommands(), []);
  useEffect(() => registerFindCommands(), []);
  useEffect(() => installRecovery(), []);
  // Each file's last view (M11-08·O3, D-53).
  useEffect(() => installLastViews(), []);
  // What's new (M10-08·O6): once after an update, a banner; always in File › About.
  useEffect(() => {
    startWhatsNew();
  }, []);
  // §9: register the service worker; after the first render, precache the rest.
  useEffect(() => {
    void startOffline().then(() => {
      setTimeout(() => {
        void startBackgroundPrecache();
      }, 1000);
    });
  }, []);
  // Pick up where you left off (M11-08·O2, D-53): last session's files, if so chosen.
  useEffect(() => installSession(), []);
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
                <ToolHint />
              </>
            ),
            pageNav: (
              <>
                <PageNav />
                <ViewHistoryNav />
              </>
            ),
            // M13-04 (D-70): the scale, the labelled toggles (Thin Lines, M13-05, then
            // Enable Snapping), a divider, the view modes and the zoom.
            view: (
              <>
                <ScaleIndicator />
                <ThinLinesStatus />
                <SnapStatus />
                <StatusDivider />
                <ViewModeSwitch />
                <ZoomBox />
              </>
            ),
          }}
          ribbon={
            <Ribbon
              onOpenBackstage={() => {
                setBackstage({});
              }}
              focusDocument={focusDocument}
            />
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
        <TellMe />
        <CloseDocumentDialog />
        <RenameFileDialog />
        <OpenErrorDialog />
        <PasswordDialog />
        <UnlockDialog />
        <PasswordSecurityDialog />
        <SignDocumentDialog />
        <SecurityInfoDialog />
        <ResetFormDialog />
        <PrintDialog />
        <PrintReadyDialog />
        <ExportOverlayDialog />
        <RegisterDialog />
        <SavePresetDialog />
        <SaveComparisonDialog />
        <RebuildComparisonDialog />
        <CloseComparisonDialog />
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
        <CommentStylesDialog />
        <StampDialog />
        <ImageStampDialog />
        <SetScaleDialog />
        <CalibrateDialog />
        <ViewportDialog />
        <CrsDialog />
        <MeasureExportDialog />
        <TemplateManager />
        <TemplateSetup />
        <AnnotationExportDialog />
        <ImportCommentsDialog />
        <FlattenDialog />
        <SnapshotToast />
        <MeasureLoupe />
        <PageImageProgress />
        <ExportDialog />
        <ExpressExtractDialog />
        <TemplatesDialog />
        <ApplyDialog />
        <OcrDialog />
        <PageDialogs />
        <BookmarkPropertiesDialog />
        <FileDialogs />
        <UpdateWaitDialog />
        <WhatsNewBanner />
        <DropZone />
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
