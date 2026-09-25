import { EmbedPDF } from '@embedpdf/core/react';
import type { ReactNode } from 'react';
import { PLUGINS } from './plugins';
import { setRegistry, useHost } from './host';

const onInitialized = (registry: Parameters<typeof setRegistry>[0]): Promise<void> => {
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
