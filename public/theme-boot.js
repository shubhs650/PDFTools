// Triya PDF (M7-11, ADR-023 D-42; accent M10 O7 and density M10 O9, ADR-027
// D-47): applies the theme, accent colour and density stored on this device
// before the first paint, so a reload never flashes light or blue, or jumps from
// comfortable to compact. A classic, blocking script in <head> (the CSP allows
// only same-origin scripts, no inline ones); src/app/theme.ts owns them
// afterwards and must use the same keys and colours (tests/app/theme.test.ts
// checks).
(function () {
  try {
    var root = document.documentElement;
    var dark = localStorage.getItem('pdftools.theme') === 'dark';
    var accent = localStorage.getItem('pdftools.accent');
    // Each accent's brand colour (theme.ts ACCENT_BRAND): the light title bar.
    var brand = { teal: '#0f766e', indigo: '#4f46e5', graphite: '#475569' };
    var known = Object.prototype.hasOwnProperty.call(brand, accent);
    if (dark) root.setAttribute('data-theme', 'dark');
    if (known) root.setAttribute('data-accent', accent);
    if (localStorage.getItem('pdftools.density') === 'compact')
      root.setAttribute('data-density', 'compact');
    if (dark || known) {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0b1120' : brand[accent]);
    }
  } catch (e) {
    // Storage blocked: the default light theme, blue accent and comfortable density.
  }
})();
