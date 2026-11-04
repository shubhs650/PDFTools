import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST } from '../src/app/manifest';
import { filesFromLaunch, installLaunchQueue } from '../src/features/open/launchQueue';

const pngSize = (path: string): [number, number] => {
  const b = readFileSync(`public/${path}`);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('web app manifest (M1-19, D-21)', () => {
  it('has the fields an installable PWA needs', () => {
    expect(MANIFEST.name).toBe('Triya PDF');
    expect(MANIFEST.short_name.length).toBeGreaterThan(0);
    expect(MANIFEST.start_url).toBe('/');
    expect(MANIFEST.display).toBe('standalone');
    expect(MANIFEST.id).toBe('/');
  });

  it('ships our own icons at 192 and 512 px, plus a maskable 512', () => {
    const png: readonly { src: string; sizes: string; purpose: string }[] = MANIFEST.icons.filter(
      (i) => i.type === 'image/png',
    );
    for (const icon of png) {
      const [w, h] = pngSize(icon.src);
      expect(`${String(w)}x${String(h)}`).toBe(icon.sizes);
    }
    expect(png.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
    expect(png.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(png.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    expect(readFileSync('public/icons/icon.svg', 'utf8')).toContain('own artwork');
  });

  it('handles .pdf files and focuses the existing window', () => {
    expect(MANIFEST.file_handlers).toEqual([
      { action: '/', accept: { 'application/pdf': ['.pdf'] } },
    ]);
    expect(MANIFEST.launch_handler).toEqual({ client_mode: 'focus-existing' });
  });
});

describe('launchQueue consumer (M1-19)', () => {
  const handle = (name: string, readable = true) =>
    ({
      kind: 'file',
      name,
      getFile: () =>
        readable ? Promise.resolve(new File(['%PDF'], name)) : Promise.reject(new Error('gone')),
    }) as unknown as FileSystemFileHandle;

  it('opens every readable file handle; skips directories and unreadable ones', async () => {
    const files = await filesFromLaunch({
      files: [
        handle('a.pdf'),
        { kind: 'directory', name: 'd' } as FileSystemHandle,
        handle('gone.pdf', false),
        handle('b.pdf'),
      ],
    });
    expect(files.map((f) => f.file.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(files.every((f) => f.handle)).toBe(true);
  });

  it('registers once where launchQueue exists, and delivers launches to the open pipeline', async () => {
    expect(installLaunchQueue({})).toBe(false);
    let consumer: ((p: { files: FileSystemHandle[] }) => Promise<void>) | undefined;
    const opened: string[][] = [];
    const ok = installLaunchQueue(
      { launchQueue: { setConsumer: (c: typeof consumer) => (consumer = c) } },
      (files) => {
        opened.push(files.map((f) => f.file.name));
        return Promise.resolve();
      },
    );
    expect(ok).toBe(true);
    await consumer?.({ files: [handle('x.pdf'), handle('y.pdf')] });
    await consumer?.({ files: [] });
    expect(opened).toEqual([['x.pdf', 'y.pdf']]);
  });
});
