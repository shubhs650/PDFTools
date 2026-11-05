// Triya PDF (M7-11, ADR-023 D-42): applies the theme stored on this device
// before the first paint, so a reload in dark never flashes light. A classic,
// blocking script in <head> (the CSP allows only same-origin scripts, no
// inline ones); src/app/theme.ts owns the theme afterwards and must use the
// same key and colours (tests/app/theme.test.ts checks).
(function () {
  try {
    if (localStorage.getItem('pdftools.theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#1f1f1f');
    }
  } catch (e) {
    // Storage blocked: the default light theme.
  }
})();
