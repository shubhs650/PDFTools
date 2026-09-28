// Calibrate (M3-15, §7.4): two clicks on a page pick the known length's ends;
// the dialog then asks the real length. A plugin tool of ours (its pointer
// plumbing, our clicks); Esc cancels. Points are page points, top-left origin.
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type {
  AnnotationCapability,
  AnnotationTool,
  HandlerFactory,
} from '@embedpdf/plugin-annotation';
import { appStore } from '../../app/store/appStore';
import { capability } from '../view/host';
import { scaleStore } from './scaleStore';

let first: { page: number; x: number; y: number } | null = null;

const handler: HandlerFactory<PdfAnnotationObject> = {
  annotationType: PdfAnnotationSubtype.LINE,
  create(context) {
    return {
      onClick: (pos) => {
        if (first?.page !== context.pageIndex) {
          first = { page: context.pageIndex, ...pos };
          return;
        }
        const a = { x: first.x, y: first.y };
        first = null;
        scaleStore.setState({
          picked: { page: context.pageIndex, a, b: { ...pos } },
          dialog: 'calibrate',
        });
        appStore.getState().setTool('select');
      },
    };
  },
};

/** Starts picking: the dialog closes until both points are clicked. */
export function startPicking(): void {
  first = null;
  scaleStore.setState({ dialog: null });
  appStore.getState().setTool('calibrate');
}

export function installCalibrateTool(registry: PluginRegistry): void {
  try {
    capability<AnnotationCapability>(registry, 'annotation').addTool({
      id: 'calibrate',
      name: 'calibrate',
      labelKey: 'annotation.calibrate',
      categories: ['measure'],
      matchScore: () => 0,
      interaction: {
        exclusive: false,
        cursor: 'crosshair',
        isDraggable: false,
        isResizable: false,
      },
      defaults: { type: PdfAnnotationSubtype.LINE },
      pointerHandler: handler,
    } as unknown as AnnotationTool);
  } catch {
    // The annotation plugin is always registered (plugins.ts).
  }
}
