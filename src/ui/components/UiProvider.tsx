import type { ReactNode } from 'react';
import { TooltipProvider } from './Tooltip';
import '../tokens.css';
import './ui.css';

/** Mount once around the app: tokens, primitive styles and tooltip timing. */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      {children}
    </TooltipProvider>
  );
}
