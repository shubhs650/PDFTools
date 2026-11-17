// Where the font library's files come from (M11-07, D-52; spike S26): the
// Google Fonts repository (github.com/google/fonts, `ofl/<dir>/`), every file
// OFL-1.1, pinned by SHA-256. Build time only (scripts/fonts/build.ts): the app
// never fetches fonts from Google (rule 4). The runtime catalogue, with the
// shipped file names, is src/model/fonts/library.ts.
//
// A variable file gives Regular and Bold (and Italic, Bold Italic from its
// italic file) by pinning `wght` (and every other axis to its default); a
// static family lists its files. Each face is cut to the scripts it is used
// for, keeping its layout tables so it can still be shaped.

import type { FaceKey } from '../../src/model/fonts/library.ts';

export type Script = 'latin' | 'deva' | 'cjk' | 'math';

export interface FaceSource {
  file: string;
  pin?: Record<string, number>;
}

export interface FamilySource {
  dir: string;
  scripts: Script[];
  faces: Partial<Record<FaceKey, FaceSource>>;
  /**
   * The license's Reserved Font Name (OFL §3): a modified copy (pinned or cut)
   * may not carry the name, so these ship as the upstream files, unmodified.
   */
  reserved?: string;
}

const vf = (upright: string, italic?: string): FamilySource['faces'] => ({
  regular: { file: upright, pin: { wght: 400 } },
  bold: { file: upright, pin: { wght: 700 } },
  ...(italic
    ? {
        italic: { file: italic, pin: { wght: 400 } },
        boldItalic: { file: italic, pin: { wght: 700 } },
      }
    : {}),
});
const st = (stem: string): FamilySource['faces'] => ({
  regular: { file: `${stem}-Regular.ttf` },
  bold: { file: `${stem}-Bold.ttf` },
  italic: { file: `${stem}-Italic.ttf` },
  boldItalic: { file: `${stem}-BoldItalic.ttf` },
});
const latin = (dir: string, faces: FamilySource['faces'], reserved?: string): FamilySource => ({
  dir: `ofl/${dir}`,
  scripts: ['latin'],
  faces,
  ...(reserved ? { reserved } : {}),
});

/** By the library family's id. */
export const SOURCES: Record<string, FamilySource> = {
  arimo: latin('arimo', vf('Arimo[wght].ttf', 'Arimo-Italic[wght].ttf')),
  tinos: latin('tinos', st('Tinos')),
  cousine: latin('cousine', st('Cousine')),
  carlito: latin('carlito', st('Carlito'), 'Carlito'),
  inter: latin('inter', vf('Inter[opsz,wght].ttf', 'Inter-Italic[opsz,wght].ttf')),
  roboto: latin('roboto', vf('Roboto[wdth,wght].ttf', 'Roboto-Italic[wdth,wght].ttf')),
  opensans: latin('opensans', vf('OpenSans[wdth,wght].ttf', 'OpenSans-Italic[wdth,wght].ttf')),
  notosans: latin('notosans', vf('NotoSans[wdth,wght].ttf', 'NotoSans-Italic[wdth,wght].ttf')),
  ibmplexsans: latin(
    'ibmplexsans',
    vf('IBMPlexSans[wdth,wght].ttf', 'IBMPlexSans-Italic[wdth,wght].ttf'),
    'Plex',
  ),
  atkinson: latin('atkinsonhyperlegible', st('AtkinsonHyperlegible')),
  robotocondensed: latin(
    'robotocondensed',
    vf('RobotoCondensed[wght].ttf', 'RobotoCondensed-Italic[wght].ttf'),
  ),
  barlowcondensed: latin('barlowcondensed', st('BarlowCondensed')),
  b612: latin('b612', st('B612')),
  overpass: latin('overpass', vf('Overpass[wght].ttf', 'Overpass-Italic[wght].ttf')),
  notoserif: latin('notoserif', vf('NotoSerif[wdth,wght].ttf', 'NotoSerif-Italic[wdth,wght].ttf')),
  sourceserif4: latin(
    'sourceserif4',
    vf('SourceSerif4[opsz,wght].ttf', 'SourceSerif4-Italic[opsz,wght].ttf'),
  ),
  robotomono: latin('robotomono', vf('RobotoMono[wght].ttf', 'RobotoMono-Italic[wght].ttf')),
  jetbrainsmono: latin(
    'jetbrainsmono',
    vf('JetBrainsMono[wght].ttf', 'JetBrainsMono-Italic[wght].ttf'),
  ),
  ibmplexmono: latin('ibmplexmono', st('IBMPlexMono'), 'Plex'),
  architectsdaughter: latin('architectsdaughter', {
    regular: { file: 'ArchitectsDaughter-Regular.ttf' },
  }),
  caveat: latin('caveat', vf('Caveat[wght].ttf')),
  kalam: {
    dir: 'ofl/kalam',
    scripts: ['latin', 'deva'],
    faces: { regular: { file: 'Kalam-Regular.ttf' }, bold: { file: 'Kalam-Bold.ttf' } },
  },
  notosansdeva: {
    dir: 'ofl/notosansdevanagari',
    scripts: ['deva'],
    faces: vf('NotoSansDevanagari[wdth,wght].ttf'),
  },
  notoserifdeva: {
    dir: 'ofl/notoserifdevanagari',
    scripts: ['deva'],
    faces: vf('NotoSerifDevanagari[wdth,wght].ttf'),
  },
  // TrueType, cut to GB 2312 (S26: the CFF Noto Sans CJK we ship for rendering does not embed reliably).
  notosanssc: { dir: 'ofl/notosanssc', scripts: ['cjk'], faces: vf('NotoSansSC[wght].ttf') },
  notosansmath: {
    dir: 'ofl/notosansmath',
    scripts: ['math'],
    faces: { regular: { file: 'NotoSansMath-Regular.ttf' } },
  },
};

export const SHA256: Record<string, string> = {
  'ArchitectsDaughter-Regular.ttf':
    '6159718a08898e34bc1cb7354086141a5f9a70b73e54dbec27ead0d59a697359',
  'Arimo-Italic[wght].ttf': 'a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed',
  'Arimo[wght].ttf': 'e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca',
  'AtkinsonHyperlegible-Bold.ttf':
    '5a3b0c8cc8ca545155150b4512a1fa248298df121c50d6557e651e61fbdab92f',
  'AtkinsonHyperlegible-BoldItalic.ttf':
    '7a46f1b0ef2f64b61065c1a6b5a11fcb9b019b44062d88ba121a083cc39e86bf',
  'AtkinsonHyperlegible-Italic.ttf':
    '021beda4d3c6edfc78872e436d74009f9a1bcb294331908fe5747c61d3dcc514',
  'AtkinsonHyperlegible-Regular.ttf':
    '7fb917c89019896d0b52ee84b7cbb3304c18cb90b19a62f5e32712bd23e97669',
  'B612-Bold.ttf': '91749541ac7b2c328b58832b7e2c4df809d7e2ba38d62a3a5aa3f8e38b271814',
  'B612-BoldItalic.ttf': '5911fe0ae69264fb74b2956fc66c616580cd392b47f29335fa68ce5db47a4d2f',
  'B612-Italic.ttf': '57fd8a0d3c8baf066f21c0a3034af277887a0b17b8c18cbbcc1c642640dd149f',
  'B612-Regular.ttf': '139dce659100a83bf95b48474696e448bee95631ef84fd3d0437ced2bf33cf73',
  'BarlowCondensed-Bold.ttf': 'e476562ec9c1e16cf16475895b511f08c804f438cc9a9f80a44ea50a0eeb5b65',
  'BarlowCondensed-BoldItalic.ttf':
    'd8694f65cd70c3e5e600ead37657aab0adb5f63b275d0c1f6f4a7046de222145',
  'BarlowCondensed-Italic.ttf': '063615da0a64f318397de2afac330dfbfbbf4cdb562a9987cb72bfdcbd37ba7c',
  'BarlowCondensed-Regular.ttf': '583cec5da3b84bc4dc7c9c72e2a565c94d34e431518b19d7e250b7830ad5f996',
  'Carlito-Bold.ttf': 'bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db',
  'Carlito-BoldItalic.ttf': 'b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517',
  'Carlito-Italic.ttf': '0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c',
  'Carlito-Regular.ttf': 'f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595',
  'Caveat[wght].ttf': '0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988',
  'Cousine-Bold.ttf': '17c8a7245156d2253531c9e529474937b09d9f641c5ae7695c5e33f22822eef4',
  'Cousine-BoldItalic.ttf': '848e858726fee0ae27b754e4cd6a2755209bf1428a8c91f747696d58c33906c3',
  'Cousine-Italic.ttf': 'ea2a76ae3d0ece9cd59f0d30fdc08dd70e8f5f457beee5b0852a7b50c2286c7c',
  'Cousine-Regular.ttf': '1da22250675fc4c42fcf3a9736c44bc0570516105331443b663fd5cfbd1412fe',
  'IBMPlexMono-Bold.ttf': 'ac27abd6450a64dd94467580a02fe6235156d5b92f2926ebbc8e7489df64e0be',
  'IBMPlexMono-BoldItalic.ttf': 'af4e05a761e98c1adf064c48a6352c9bec1a6ad70982cd2a544149323391f98e',
  'IBMPlexMono-Italic.ttf': '3362fc791b0652193328b862c1c5f23a789bc7288b1617fa63302f88689a2a34',
  'IBMPlexMono-Regular.ttf': '6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46',
  'IBMPlexSans-Italic[wdth,wght].ttf':
    '0b94c5e981993764db32bf9c610ecc60cbd34ad77ec2f10ba03c64ab75124d8e',
  'IBMPlexSans[wdth,wght].ttf': '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3',
  'Inter-Italic[opsz,wght].ttf': 'acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6',
  'Inter[opsz,wght].ttf': '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
  'JetBrainsMono-Italic[wght].ttf':
    '85ae2a5cd3f56baf1ce1c21a851322c58e3d8fbe8e8ad4a4d090a820dd7fe558',
  'JetBrainsMono[wght].ttf': '48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda',
  'Kalam-Bold.ttf': '2f6576601db015d4f6c08678120277fc8510b98c06e932ce7a6a9cbff4cbdded',
  'Kalam-Regular.ttf': '57cecb63d4608019371954274ae1d8c397764debd5b19d4a33c1efa4dc923c0b',
  'NotoSans-Italic[wdth,wght].ttf':
    '58e6e0ebd1931b29a365aa2d3e2ee9a9e831a3af7cf3ad1462d4e72154f0b291',
  'NotoSansDevanagari[wdth,wght].ttf':
    '14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e',
  'NotoSansMath-Regular.ttf': '3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d',
  'NotoSansSC[wght].ttf': 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da',
  'NotoSans[wdth,wght].ttf': 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
  'NotoSerif-Italic[wdth,wght].ttf':
    'e87acbc6c0efd0d9a20d6a8cbbda2b266c14be3a3a6f5af8ec9d7b2460570ad1',
  'NotoSerifDevanagari[wdth,wght].ttf':
    '1191e07bfeb062d80e252eb85b0eafdfbda1e350707a2a60628668e8f677dbbb',
  'NotoSerif[wdth,wght].ttf': '4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713',
  'OpenSans-Italic[wdth,wght].ttf':
    'fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b',
  'OpenSans[wdth,wght].ttf': '36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878',
  'Overpass-Italic[wght].ttf': '3b45ac4193930bbeb491b5c76227afd5991607712f0d16d6bc5d74db6bbd8172',
  'Overpass[wght].ttf': '970717df17a7f9911dee45f60695d05bfa9d745fa0a11fc5c348371fa21f0073',
  'Roboto-Italic[wdth,wght].ttf':
    '9725a847af6b460ffca162ae66d20dad48b01876137947180b42d7dcd7887182',
  'RobotoCondensed-Italic[wght].ttf':
    '78f643b1923008b00dfc9b371a2ecd4d80a017722925f1a3fac9940be56d1b7d',
  'RobotoCondensed[wght].ttf': 'dace262afcee68a5276f200d8026c57221735c0118ab5fda8c2c0d3dc409a8d0',
  'RobotoMono-Italic[wght].ttf': '49ac343bb7b070071e53f0a8a501d68d140ed98ebd0a43b6b8fb96cf22f09ff7',
  'RobotoMono[wght].ttf': '66a80e79d17e4c7cabd162e2916578a4cc08fd19eef6e2a643305eae9c567b2b',
  'Roboto[wdth,wght].ttf': 'd7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134',
  'SourceSerif4-Italic[opsz,wght].ttf':
    '15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42',
  'SourceSerif4[opsz,wght].ttf': '97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b',
  'Tinos-Bold.ttf': '393269dbab8899f938db19783eca5eac92eb431f7ae0ab45b8349ca895f1a06b',
  'Tinos-BoldItalic.ttf': 'a5de79f0fe863ea0954757acb3d47b3ccd0a930ce3dd5b97230cd3866790a06e',
  'Tinos-Italic.ttf': '5942266ed398b155d7dc23e36833e7ec6be988f2439bdbeb8ef1bede808eaa91',
  'Tinos-Regular.ttf': '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61',
};

type Range = [number, number];

/** Latin for English, Spanish, French and other Latin-script languages, Greek, and the technical symbols. */
const LATIN: Range[] = [
  [0x20, 0x7e],
  [0xa0, 0x24f], // Latin-1, Extended-A, Extended-B
  [0x259, 0x259],
  [0x2b0, 0x2ff], // spacing modifiers
  [0x300, 0x36f], // combining marks
  [0x370, 0x3ff], // Greek (µ Ω Δ π θ)
  [0x1e00, 0x1eff], // Latin Extended Additional (Vietnamese)
  [0x2000, 0x206f], // punctuation (– — … ′ ″ ‰)
  [0x2070, 0x209f], // super- and subscripts
  [0x20a0, 0x20cf], // currency (€ ₹)
  [0x2100, 0x218f], // letterlike, number forms (℃ ™ ½ ⅓)
  [0x2190, 0x21ff], // arrows
  [0x2200, 0x22ff], // mathematical operators
  [0x2300, 0x23ff], // technical (⌀)
  [0x25a0, 0x25ff], // geometric shapes
  [0xfb00, 0xfb06], // ligatures
  [0xfffd, 0xfffd],
];
const DEVA: Range[] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x900, 0x97f],
  [0x1cd0, 0x1cff],
  [0xa8e0, 0xa8ff],
  [0x200b, 0x200d],
  [0x2010, 0x2027],
  [0x20b9, 0x20b9],
  [0x25cc, 0x25cc], // dotted circle, for a lone vowel sign
];
const MATH: Range[] = [
  [0x370, 0x3ff],
  [0x2070, 0x209f],
  [0x2100, 0x214f],
  [0x2190, 0x21ff],
  [0x2200, 0x22ff],
  [0x2300, 0x23ff],
  [0x25a0, 0x25ff],
];

/**
 * Simplified Chinese: the GB 2312 repertoire (6,763 hanzi and its symbols; read
 * through the GBK decoder, which adds a few symbols), CJK punctuation, full-width
 * forms and basic Latin. M11-07 may widen it to the 8,105 characters of the
 * Table of General Standard Chinese Characters (Unihan kTGH).
 */
function CJK(): Range[] {
  const out: Range[] = [
    [0x20, 0x7e],
    [0xa0, 0xff],
    [0x2000, 0x206f],
    [0x3000, 0x303f],
    [0xff00, 0xffef],
  ];
  const dec = new TextDecoder('gbk');
  for (let a = 0xa1; a < 0xf8; a++)
    for (let b = 0xa1; b < 0xff; b++) {
      const s = dec.decode(new Uint8Array([a, b]));
      const c = s.codePointAt(0) ?? 0xfffd;
      if (s.length === 1 && c !== 0xfffd) out.push([c, c]);
    }
  return out;
}

export function rangesFor(scripts: Script[]): Range[] {
  const out: Range[] = [];
  for (const s of scripts) {
    if (s === 'latin') out.push(...LATIN);
    if (s === 'deva') out.push(...DEVA);
    if (s === 'math') out.push(...MATH);
    if (s === 'cjk') out.push(...CJK());
  }
  return out;
}

export function* codepoints(ranges: Range[]): Generator<number> {
  for (const [a, b] of ranges) for (let c = a; c <= b; c++) yield c;
}
