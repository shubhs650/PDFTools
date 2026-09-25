// Files from a drop (§4.1): Explorer, Outlook attachments, other apps. Handles
// must be requested synchronously inside the drop event, so this collects the
// promises first and awaits them afterwards.
import type { OpenedFile } from '../../storage/fileAccess';

interface HandleItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

export function collectDropped(dt: DataTransfer): Promise<OpenedFile[]> {
  const pending: Promise<OpenedFile | null>[] = [];
  for (const item of dt.items) {
    if (item.kind !== 'file') continue;
    // Both calls must happen now, while the drop event is being dispatched.
    const file = item.getAsFile();
    const handle = (item as DataTransferItem & HandleItem).getAsFileSystemHandle?.();
    pending.push(
      (async (): Promise<OpenedFile | null> => {
        const h = await handle?.catch(() => null);
        // Outlook attachments and virtual files have no file-system entry.
        if (h?.kind === 'file') {
          const fh = h as FileSystemFileHandle;
          return { file: file ?? (await fh.getFile()), handle: fh };
        }
        return file ? { file } : null;
      })(),
    );
  }
  return Promise.all(pending).then((all) => all.filter((f): f is OpenedFile => f !== null));
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return dt?.types.includes('Files') ?? false;
}
