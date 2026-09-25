// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { downloadBytes, pickPdfFiles, pickSaveTarget } from '../../src/storage/fileAccess';

// jsdom has no File System Access API, like Firefox and Safari.

describe('fallback path (M1-12, §4.1)', () => {
  it('opens through <input type=file> accepting PDFs', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      expect(this.type).toBe('file');
      expect(this.accept).toBe('.pdf,application/pdf');
      expect(this.multiple).toBe(true);
      const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
      Object.defineProperty(this, 'files', { value: [file] });
      this.dispatchEvent(new Event('change'));
    });
    const opened = await pickPdfFiles();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.file.name).toBe('a.pdf');
    expect(opened[0]?.handle).toBeUndefined();
    click.mockRestore();
  });

  it('resolves [] when the picker is cancelled', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      this.dispatchEvent(new Event('cancel'));
    });
    expect(await pickPdfFiles()).toEqual([]);
    click.mockRestore();
  });

  it('has no save target, so saving downloads a new file', async () => {
    expect(await pickSaveTarget('a.pdf')).toBeUndefined();
    const created: string[] = [];
    URL.createObjectURL = vi.fn(() => {
      created.push('blob:x');
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: { download: string; href: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
    downloadBytes(new Uint8Array([1, 2, 3]), 'out.pdf');
    expect(clicked).toEqual([{ download: 'out.pdf', href: 'blob:x' }]);
    expect(document.querySelector('a')).toBeNull(); // removed after click
    click.mockRestore();
  });
});
