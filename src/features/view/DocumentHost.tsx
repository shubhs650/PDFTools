import { EmbedPDF } from '@embedpdf/core/react';
import type { ReactNode } from 'react';
import type { InteractionManagerCapability } from '@embedpdf/plugin-interaction-manager';
import { HAND_MODE, PLUGINS } from './plugins';
import { installAuthoring } from '../annotate/authoring';
import { capability, setRegistry, useHost } from './host';

const onInitialized = (registry: Parameters<typeof setRegistry>[0]): Promise<void> => {
  // Hand (§8.1): our own panning on the viewport; pages get no pointer
  // handlers in this mode, so it never starts a text selection (M2-04).
  if (registry) {
    capability<InteractionManagerCapability>(registry, 'interaction-manager').registerMode({
      id: HAND_MODE,
      scope: 'page',
      exclusive: false,
    });
    installAuthoring(registry);
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
