// File → About → Open-source licenses (M10-01, ADR-027 D-48): helpers shared
// by the view and its unit test.
import type { LicensePackage } from './licenseData';

/** Emitted next to index.html by the build (scripts/notices.ts). */
export const NOTICES_URL = 'third-party-notices.txt';

/** Packages whose name, version or license contains every word of `query` (case-insensitive). */
export function filterPackages(
  packages: readonly LicensePackage[],
  query: string,
): readonly LicensePackage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return packages;
  return packages.filter((p) => {
    const hay = `${p.name} ${p.version} ${p.license}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
