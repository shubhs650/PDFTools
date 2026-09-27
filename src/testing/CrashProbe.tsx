import { useEffect, useState } from 'react';

// e2e only (M1-Q3; loaded by App.tsx behind the e2e mode check): throws while
// rendering when the page dispatches `pdftools:crash`, with a message and a
// stack that carry content-like text, so tests see the error boundary's report
// offer and the sanitizer at work (M2-17).
export const CRASH_EVENT = 'pdftools:crash';

export default function CrashProbe() {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    const on = (): void => {
      setCrash(true);
    };
    window.addEventListener(CRASH_EVENT, on);
    document.documentElement.dataset['crashProbe'] = 'ready';
    return () => {
      window.removeEventListener(CRASH_EVENT, on);
    };
  }, []);
  if (crash) {
    const err = new Error('Could not read "Confidential bid" in C:\\Users\\alice\\bid 2026.pdf');
    err.stack =
      `Error: ${err.message}\n` +
      `    at readPage (${location.origin}/assets/index-abc123.js:1:2345)\n` +
      '    at parse (blob:https://example.com/0f1e2d3c-aaaa-bbbb-cccc-000000000000:9:10)\n' +
      '    at open (file:///home/alice/Documents/contract%20final.pdf:1:1)\n' +
      '    at load (/home/alice/projects/secret-plan.dwg:3:4)\n' +
      '    at mail (alice@example.com)';
    throw err;
  }
  return null;
}
