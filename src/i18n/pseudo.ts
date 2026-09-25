// Pseudo-locale for layout testing (§8.2: layouts tolerate +40 % label length).
// Accents every letter, pads to at least +40 % length and brackets the result,
// so clipped or concatenated strings are easy to spot. Placeholders
// ({{name}}) and tags (<0>…</0>) are kept intact.

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

const PROTECTED = /(\{\{[^}]*\}\}|<\/?\d+>|<\/?[a-z]+\s*\/?>)/;

export const PSEUDO_LOCALE = 'en-XA';
export const PSEUDO_EXPANSION = 0.4;

export function pseudoLocalize(text: string): string {
  let visible = 0;
  const out = text
    .split(PROTECTED)
    .map((part, i) => {
      if (i % 2 === 1) return part; // placeholder or tag
      visible += part.length;
      return part.replace(/[A-Za-z]/g, (ch) => ACCENTS[ch] ?? ch);
    })
    .join('');
  const pad = Math.ceil(visible * PSEUDO_EXPANSION);
  return `[${out}${pad > 0 ? ` ${'~'.repeat(Math.max(1, pad - 1))}` : ''}]`;
}

/** Applies pseudoLocalize to every string leaf of a resource tree. */
export function pseudoResources<T>(tree: T): T {
  if (typeof tree === 'string') return pseudoLocalize(tree) as T;
  if (tree && typeof tree === 'object') {
    return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, pseudoResources(v)])) as T;
  }
  return tree;
}
