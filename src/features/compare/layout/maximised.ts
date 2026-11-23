// Whether a comparison is maximised (Maximise in its header, M12-25, ADR-033).
import { useApp } from '../../../app/store/appStore';

export function useMaximised(id: string): boolean {
  return useApp((s) => s.maximised === id);
}
