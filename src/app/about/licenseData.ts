// The in-app Open-source licenses list (M10-01, ADR-027 D-48). Imported only
// with import() from About, so it is its own chunk (about 300 KB) in the
// background precache (src/sw/precacheSplit.ts), not the app's core. It is an
// app module like any other: no network call to a third party (rule 4).
import data from 'virtual:open-source-licenses';

export type LicenseData = typeof data;
export type LicensePackage = LicenseData['packages'][number];

export default data;
