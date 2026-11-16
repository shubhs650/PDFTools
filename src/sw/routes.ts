// Which page the service worker answers a navigation with (M10-01, ADR-027 D-48).
// Shared by the service worker and its unit test.
//
// Before M10 every navigation got the app's index.html (only /help was
// special, M9), so a link to a real file, such as File → About → Third-party
// notices (`third-party-notices.txt`), opened a second copy of the app once
// the service worker controlled the site. Now only app routes get the app:
// `/`, `/index.html` and extensionless paths. A path with a file extension is
// served as that file, from the cache when it is there (offline too), else
// from the network.

export type NavigationPage = 'app' | 'help' | 'file';

/** The last path segment has an extension (`.txt`, `.pdf` …), so it names a file. */
const FILE_EXTENSION = /\.[a-z0-9]+$/i;

/**
 * The page for a navigation to `pathname`. `helpPaths` are the Help window's
 * own paths (`/help` and `/help.html` under the service worker's scope).
 */
export function navigationPage(pathname: string, helpPaths: ReadonlySet<string>): NavigationPage {
  if (helpPaths.has(pathname)) return 'help';
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last === '' || last === 'index.html') return 'app';
  return FILE_EXTENSION.test(last) ? 'file' : 'app';
}
