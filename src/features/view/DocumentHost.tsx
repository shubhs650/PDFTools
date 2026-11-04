import { EmbedPDF } from '@embedpdf/core/react';
import type { ReactNode } from 'react';
import type { InteractionManagerCapability } from '@embedpdf/plugin-interaction-manager';
import { HAND_MODE, PLUGINS, SELECT_COMMENTS_MODE } from './plugins';
import { installAuthoring } from '../annotate/authoring';
import { installFlagPolicy } from '../annotate/flagPolicy';
import { installDrawTools } from '../annotate/tools/drawTools';
import { installStampTools } from '../stamps/stampTools';
import { installCalibrateTool } from '../measure/calibrate';
import { installMeasurements } from '../measure/measurements';
import { installMeasureTools } from '../measure/measureTools';
import { installViewportTool } from '../measure/viewports';
import { installSnapping } from '../measure/snapping';
import { installHistoryJoin } from '../annotate/historyJoin';
import { installTextEdit } from '../annotate/textEdit';
import { installTextPointer } from '../annotate/textPointer';
import { installCommentSelection } from '../annotate/commentSelection';
import { installSelectAfterDraw } from '../annotate/selectAfterDraw';
import { installCommitGuard } from '../annotate/commitGuard';
import { installAttachmentRefresh } from '../attachments/attachments';
import { installSignTools } from '../sign/signDocument';
import { installFieldTools } from '../forms/fieldTools';
import { capability, setRegistry, useHost } from './host';

let textEditInstalled = false;

const onInitialized = (registry: Parameters<typeof setRegistry>[0]): Promise<void> => {
  // Hand (§8.1): our own panning on the viewport; pages get no pointer
  // handlers in this mode, so it never starts a text selection (M2-04).
  if (registry) {
    const im = capability<InteractionManagerCapability>(registry, 'interaction-manager');
    im.registerMode({ id: HAND_MODE, scope: 'page', exclusive: false });
    // Select Comments (M7-04): presses go to comments and the marquee, never to text.
    im.registerMode({ id: SELECT_COMMENTS_MODE, scope: 'page', exclusive: false });
    installAuthoring(registry);
    installFlagPolicy(registry);
    installHistoryJoin(registry);
    // Before installDrawTools rewraps the line/polyline/polygon tools they build on.
    installMeasureTools(registry);
    installDrawTools(registry);
    installStampTools(registry);
    installCalibrateTool(registry);
    installViewportTool(registry);
    installMeasurements(registry);
    installSnapping();
    installAttachmentRefresh(registry);
    installSignTools(registry);
    installFieldTools(registry);
    // Marquee, Shift+click (M7-04), the comment just drawn stays selected (B9)
    // and a change made during a commit is written too (B13).
    installCommentSelection(registry);
    installSelectAfterDraw(registry);
    installCommitGuard(registry);
    // Text comment edits are written on every way out of the editor (M7-02).
    // … and pressed, dragged or double-clicked like PDF-XChange's (M7-03).
    if (!textEditInstalled) {
      installTextEdit();
      installTextPointer();
    }
    textEditInstalled = true;
  }
  setRegistry(registry);
  return Promise.resolve();
};

/**
 * Mounts EmbedPDF's plugin registry once the Render engine exists (first
 * open). Before that, children render without it (start screen).
 */
export function DocumentHost({ children }: { children: ReactNode }) {
  const render = useHost((s) => s.render);
  if (!render) return children;
  return (
    <EmbedPDF engine={render.engine} plugins={PLUGINS} onInitialized={onInitialized}>
      {children}
    </EmbedPDF>
  );
}
