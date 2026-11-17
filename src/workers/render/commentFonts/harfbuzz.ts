// HarfBuzz for comment fonts (M11-07, D-52): its own chunk (and `harfbuzz.wasm`
// next to it), loaded by the Render worker the first time a comment uses a
// library font, and precached in the background (src/sw/precacheSplit.ts).
export * from 'harfbuzzjs';
