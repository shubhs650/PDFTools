// Ribbon command table (M1-06), seeded from the M0-S6 inventory (ADR-010).
// Pure data with no imports, so scripts/gen-icons.ts can read it under Node.
//
// - Labels: en.json `command.<id>`; tabs `ribbon.tab.<tab>`; groups `ribbon.group.<tab>.<group>`.
// - `fluent`: Fluent UI System Icons base name (Regular; Filled for `toggle` pressed state).
// - `custom`: a custom icon drawn in src/ui/icons/custom (same style, rule 15).
// - `customPending`: a custom icon is planned (ADR-010 finding 5); the Fluent glyph is the
//   interim fallback until the milestone that ships the command draws it.
// - `milestone`: when the command ships. Only AVAILABLE_MILESTONES are shown; later ones are
//   omitted, not disabled (ADR-001 B6, M1-Q2).
// - `shipped`: a command of a later milestone that already works (tasks land one by one);
//   shown like an available milestone's commands.

export type CommandSize = 'large' | 'small';
export type Milestone = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'later';
export type CommandTab =
  | 'quickAccess'
  | 'file'
  | 'home'
  | 'view'
  | 'comment'
  | 'form'
  | 'measure'
  | 'organize'
  | 'convert'
  | 'protect'
  | 'help'
  | 'rail'
  | 'status'
  /** The right end of the ribbon's tab row (M6-01, ADR-021 D-35). */
  | 'topBar'
  /** Context menus only (M6-02, ADR-021 D-38): never a ribbon button. */
  | 'menu';

export interface CommandDef {
  id: string;
  tab: CommandTab;
  group: string;
  size: CommandSize;
  fluent: string;
  milestone: Milestone;
  toggle?: true;
  /**
   * Icon only in the ribbon (a tool grid): the label is the accessible name and
   * the tooltip, as in a desktop editor's drawing palette. Keeps the Comment tab
   * inside 1280 px (§8) without clipping any label.
   */
  compact?: true;
  custom?: string;
  customPending?: true;
  shipped?: true;
  /**
   * Shorter visible ribbon text (en.json `commandShort.<id>`); the full label
   * stays the accessible name and the tooltip, and must contain the short text
   * (WCAG 2.5.3 label in name; checked by tests/icons.test.ts).
   */
  short?: true;
}

/** Milestones whose commands are shown. Extend as milestones land. */
export const AVAILABLE_MILESTONES: readonly Milestone[] = ['M1', 'M2', 'M3', 'M4', 'M5'];

/** Ribbon tabs in order (§8, authoritative). */
export const RIBBON_TABS = [
  'file',
  'home',
  'view',
  'comment',
  // Form (M6-14, ADR-021 D-36): field creation.
  'form',
  'measure',
  'organize',
  'convert',
  'protect',
  'help',
] as const satisfies readonly CommandTab[];

/**
 * A tab's copies of other tabs' commands (layout reference): same ids, icons
 * and handlers, in the tab's own group (label `ribbon.group.<tab>.<group>`).
 * Copies are small buttons with labels, except the ids in `large`.
 */
export interface ReuseGroup {
  tab: CommandTab;
  group: string;
  ids: readonly string[];
  large?: readonly string[];
}

export const REUSE_GROUPS: readonly ReuseGroup[] = [
  // Home (preview review UI01; M6-08, beta review A2b–A2d).
  {
    tab: 'home',
    group: 'zoom',
    ids: ['view.zoomIn', 'view.zoomOut', 'view.fitPage', 'view.fitWidth'],
  },
  {
    tab: 'home',
    group: 'comment',
    ids: [
      'comment.highlight',
      'comment.stickyNote',
      'comment.textBox',
      'comment.callout',
      'comment.line',
      'comment.arrow',
      'comment.rectangle',
      'comment.cloud',
      'comment.stamp',
    ],
  },
  { tab: 'home', group: 'measure', ids: ['measure.distance'] },
  // Home rotates the view; Organize rotates the pages (owner's answer 6, M6 plan).
  { tab: 'home', group: 'rotation', ids: ['view.rotateCw', 'view.rotateCcw'] },
  { tab: 'home', group: 'view', ids: ['view.propertiesPane'] },
  { tab: 'home', group: 'protect', ids: ['protect.signatures'] },
  // Comment (M6-08, beta review B7a, B7b): the pointer tools and the measurements.
  {
    tab: 'comment',
    group: 'tools',
    ids: ['home.hand', 'home.selectText', 'home.selectAnnotations'],
    large: ['home.selectAnnotations'],
  },
  {
    tab: 'comment',
    group: 'measure',
    ids: ['measure.distance', 'measure.perimeter', 'measure.area'],
  },
  // Form (M6-14): the pointer tools and Reset Form.
  { tab: 'form', group: 'tools', ids: ['home.hand', 'home.selectText'] },
  { tab: 'form', group: 'manage', ids: ['home.resetForm'], large: ['home.resetForm'] },
];

/**
 * Group order where a tab mixes its own and reused groups (M6-08); other tabs
 * keep the command table's order, reused groups last.
 */
export const GROUP_ORDER: Partial<Record<CommandTab, readonly string[]>> = {
  home: ['tools', 'find', 'forms', 'zoom', 'comment', 'measure', 'rotation', 'view', 'protect'],
  comment: ['tools', 'text', 'note', 'textMarkup', 'drawing', 'stamp', 'measure', 'manage'],
  form: ['tools', 'fields', 'view', 'manage'],
};

/**
 * How long a group keeps its full size as the window narrows (D-36): higher
 * steps down later; equal ones step down from the right. Default 0.
 */
export const GROUP_PRIORITY: Readonly<Record<string, number>> = {
  'comment.text': 4,
  'comment.textMarkup': 4,
  'comment.drawing': 4,
  'comment.note': 3,
  'comment.tools': 2,
  'comment.stamp': 1,
  'home.tools': 4,
  'home.comment': 3,
  'home.zoom': 2,
  'home.find': 1,
};

export const COMMANDS: readonly CommandDef[] = [
  {
    id: 'qat.open',
    tab: 'quickAccess',
    group: 'quickAccess',
    size: 'small',
    fluent: 'FolderOpen',
    milestone: 'M1',
  },
  {
    id: 'qat.save',
    tab: 'quickAccess',
    group: 'quickAccess',
    size: 'small',
    fluent: 'Save',
    milestone: 'M1',
  },
  {
    id: 'qat.print',
    tab: 'quickAccess',
    group: 'quickAccess',
    size: 'small',
    fluent: 'Print',
    milestone: 'M2',
    shipped: true, // M2-15
  },
  {
    id: 'qat.undo',
    tab: 'quickAccess',
    group: 'quickAccess',
    size: 'small',
    fluent: 'ArrowUndo',
    milestone: 'M3',
    shipped: true, // M3-05
  },
  {
    id: 'qat.redo',
    tab: 'quickAccess',
    group: 'quickAccess',
    size: 'small',
    fluent: 'ArrowRedo',
    milestone: 'M3',
    shipped: true, // M3-05
  },
  {
    id: 'file.open',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'FolderOpen',
    milestone: 'M1',
  },
  {
    id: 'file.recent',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'History',
    milestone: 'M1',
  },
  {
    id: 'file.save',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'Save',
    milestone: 'M1',
  },
  {
    id: 'file.saveAs',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'SaveCopy',
    milestone: 'M1',
  },
  {
    id: 'file.saveOptimized',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'Save',
    milestone: 'M1',
    custom: 'file.saveOptimized',
  },
  {
    id: 'file.print',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'Print',
    milestone: 'M2',
    shipped: true, // M2-15
  },
  {
    id: 'file.exportPrintReady',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'DocumentBorderPrint',
    milestone: 'M2',
    shipped: true, // M2-16
  },
  {
    id: 'file.properties',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'DocumentBulletList',
    milestone: 'M2',
    shipped: true, // M2-12
  },
  {
    id: 'file.settings',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'Settings',
    milestone: 'M1',
  },
  {
    id: 'file.about',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'Info',
    milestone: 'M1',
  },
  {
    id: 'file.privacy',
    tab: 'file',
    group: 'backstage',
    size: 'large',
    fluent: 'ShieldCheckmark',
    milestone: 'M1',
  },
  {
    id: 'home.hand',
    tab: 'home',
    group: 'tools',
    size: 'large',
    fluent: 'HandLeft',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'home.select',
    tab: 'home',
    group: 'tools',
    size: 'large',
    fluent: 'Cursor',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'home.selectText',
    tab: 'home',
    group: 'tools',
    size: 'small',
    fluent: 'TextT',
    milestone: 'M2',
    shipped: true, // M2-19 (text selection itself: M2-04)
    toggle: true,
  },
  {
    id: 'home.selectAnnotations',
    tab: 'home',
    group: 'tools',
    size: 'small',
    fluent: 'Cursor',
    milestone: 'M3',
    shipped: true, // M3-05
    toggle: true,
  },
  {
    id: 'home.find',
    tab: 'home',
    group: 'find',
    size: 'small',
    fluent: 'Search',
    milestone: 'M2',
    shipped: true, // M2-07
  },
  {
    id: 'home.advancedSearch',
    tab: 'home',
    group: 'find',
    size: 'small',
    fluent: 'DocumentSearch',
    milestone: 'M2',
    shipped: true, // M2-09
  },
  {
    id: 'home.resetForm',
    tab: 'home',
    group: 'forms',
    size: 'small',
    fluent: 'ArrowReset',
    milestone: 'M2',
    shipped: true, // M2-14
  },
  {
    // Home → View (M6-09, beta review A2a, D-38 e): drag a rectangle, its picture
    // goes to the system clipboard. Listed before the reused Properties Pane.
    id: 'home.snapshot',
    tab: 'home',
    group: 'view',
    size: 'small',
    fluent: 'Screenshot',
    milestone: 'M6',
    toggle: true,
    shipped: true,
  },
  {
    id: 'view.firstPage',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ArrowPrevious',
    milestone: 'M1',
  },
  {
    id: 'view.prevPage',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ChevronLeft',
    milestone: 'M1',
  },
  {
    id: 'view.nextPage',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ChevronRight',
    milestone: 'M1',
  },
  {
    id: 'view.lastPage',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ArrowNext',
    milestone: 'M1',
  },
  {
    id: 'view.prevView',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ArrowCircleLeft',
    milestone: 'M2',
    shipped: true, // M2-10
  },
  {
    id: 'view.nextView',
    tab: 'view',
    group: 'goTo',
    size: 'small',
    fluent: 'ArrowCircleRight',
    milestone: 'M2',
    shipped: true, // M2-10
  },
  {
    id: 'view.actualSize',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'RatioOneToOne',
    milestone: 'M1',
  },
  {
    id: 'view.fitPage',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'PageFit',
    milestone: 'M1',
  },
  {
    id: 'view.fitWidth',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'ArrowAutofitWidth',
    milestone: 'M1',
  },
  {
    id: 'view.fitVisible',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'ArrowAutofitContent',
    milestone: 'M1',
  },
  {
    id: 'view.zoomIn',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'ZoomIn',
    milestone: 'M1',
  },
  {
    id: 'view.zoomOut',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'ZoomOut',
    milestone: 'M1',
  },
  {
    id: 'view.loupe',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'SearchSquare',
    milestone: 'later',
    toggle: true,
    customPending: true,
  },
  {
    id: 'view.panZoom',
    tab: 'view',
    group: 'zoom',
    size: 'small',
    fluent: 'WindowLocationTarget',
    milestone: 'later',
    toggle: true,
    customPending: true,
  },
  {
    id: 'view.singlePage',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'DocumentOnePage',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'view.continuous',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'StackVertical',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'view.facing',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'BookOpen',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'view.continuousFacing',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'BookOpen',
    milestone: 'M1',
    toggle: true,
    custom: 'view.continuousFacing',
  },
  {
    id: 'view.rotateCw',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'ArrowRotateClockwise',
    milestone: 'M1',
  },
  {
    id: 'view.rotateCcw',
    tab: 'view',
    group: 'pageDisplay',
    size: 'small',
    fluent: 'ArrowRotateCounterclockwise',
    milestone: 'M1',
  },
  {
    id: 'view.leftPanes',
    tab: 'view',
    group: 'window',
    size: 'small',
    fluent: 'PanelLeft',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'view.propertiesPane',
    tab: 'view',
    group: 'window',
    size: 'small',
    fluent: 'PanelRight',
    milestone: 'M1',
    toggle: true,
  },
  {
    id: 'view.collapseRibbon',
    tab: 'view',
    group: 'window',
    size: 'small',
    fluent: 'PanelTopContract',
    milestone: 'M1',
  },
  // Comment tab (M6-08, ADR-021 D-36, beta review B7a): Tools (reused from Home),
  // Text, Note, Text Markup, Drawing, Stamp, Measure (reused), Manage Comments.
  {
    id: 'comment.typewriter',
    tab: 'comment',
    group: 'text',
    size: 'small',
    fluent: 'DrawText',
    milestone: 'M6',
    toggle: true,
    shipped: true, // M6-08 (the tool itself: M6-03)
  },
  {
    id: 'comment.textBox',
    tab: 'comment',
    group: 'text',
    size: 'small',
    fluent: 'Textbox',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.callout',
    tab: 'comment',
    group: 'text',
    size: 'small',
    fluent: 'TooltipQuote',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.stickyNote',
    tab: 'comment',
    group: 'note',
    size: 'large',
    fluent: 'Note',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-09
  },
  {
    // Attach File (M6-10, beta review B7c, D-38 d): click on a page, choose a file.
    id: 'comment.attachFile',
    tab: 'comment',
    group: 'note',
    size: 'large',
    fluent: 'Attach',
    milestone: 'M6',
    toggle: true,
    shipped: true,
  },
  {
    id: 'comment.highlight',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'Highlight',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
  },
  {
    id: 'comment.underline',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'TextUnderline',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
  },
  {
    id: 'comment.strikeout',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'TextStrikethrough',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
  },
  {
    id: 'comment.squiggly',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'TextUnderline',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
    custom: 'comment.squiggly', // M3-06
  },
  {
    id: 'comment.insertText',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'TextAdd',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
  },
  {
    id: 'comment.replaceText',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'TextEditStyle',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-08
    custom: 'comment.replaceText', // M3-06
  },
  {
    // A yellow rectangle blended with Multiply (a Square annotation, /BM in its appearance).
    id: 'comment.highlightArea',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'SquareHint',
    milestone: 'M6',
    toggle: true,
    shipped: true, // M6-08
  },
  {
    id: 'comment.inkHighlighter',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'InkingTool',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.line',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'Line',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.arrow',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'ArrowUpRight',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.polyline',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'LineFlowDiagonalUpRight',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.polygon',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'Pentagon',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.rectangle',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'RectangleLandscape',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.oval',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'Oval',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.cloud',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'Cloud',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
    custom: 'comment.cloud', // M3-06
  },
  {
    id: 'comment.pencil',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'Pen',
    milestone: 'M3',
    toggle: true,
    compact: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.stamp',
    tab: 'comment',
    group: 'stamp',
    size: 'large',
    fluent: 'ApprovalsApp',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-14
    custom: 'comment.stamp', // M3-06
  },
  {
    id: 'comment.imageStamp',
    tab: 'comment',
    group: 'stamp',
    size: 'small',
    fluent: 'ImageAdd',
    milestone: 'M3',
    shipped: true, // M3-14
  },
  {
    id: 'comment.link',
    tab: 'comment',
    group: 'stamp',
    size: 'small',
    fluent: 'Link',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-09
  },
  {
    id: 'comment.commentsPane',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'CommentMultiple',
    milestone: 'M3',
    short: true,
    shipped: true, // M3-11
  },
  {
    id: 'comment.importComments',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'ArrowImport',
    milestone: 'M4',
    short: true,
    shipped: true, // M4-20
  },
  {
    id: 'comment.exportAnnotations',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'ArrowExport',
    milestone: 'M4',
    short: true, // M3-Q1: annotation export is M4 (§13)
    shipped: true, // M4-08
  },
  {
    id: 'comment.exportCrs',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'DocumentTableArrowRight',
    milestone: 'M3',
    short: true,
    shipped: true, // M3-19
    custom: 'comment.exportCrs', // M3-06
  },
  {
    id: 'comment.flatten',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'LayerDiagonal',
    milestone: 'M6',
    short: true,
    shipped: true, // M6-09: Flatten Comments dialog (D-38 c)
  },
  {
    id: 'comment.stylesPalette',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'Color',
    milestone: 'M6',
    shipped: true, // M6-07: the user's own comment styles (D-37)
  },
  {
    id: 'comment.filter',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'Filter',
    milestone: 'M3',
    short: true,
    shipped: true, // M3-11
  },
  {
    id: 'comment.statusSchemes',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'Status',
    milestone: 'M3',
    shipped: true, // M3-13
  },
  {
    id: 'comment.reviewerProfile',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'PersonEdit',
    milestone: 'M3',
    shipped: true, // M3-07
  },
  {
    id: 'comment.autoNumber',
    tab: 'comment',
    group: 'manage',
    size: 'small',
    fluent: 'NumberSymbolSquare',
    milestone: 'M3',
    short: true,
    toggle: true,
    shipped: true, // M3-11
  },
  // Review and transfer (M3-10 … M4-21): no longer ribbon buttons (M6-08, B7a);
  // the comment menus and the Comments pane's toolbar show them, the keymap keeps them.
  {
    id: 'comment.reply',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowReply',
    milestone: 'M3',
    shipped: true, // M3-12
  },
  {
    // The same action as the Delete key, the comment menus and the Comments pane.
    id: 'comment.delete',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Delete',
    milestone: 'M3',
    shipped: true,
  },
  {
    // A file attachment's menu (M6-10): its file, where the user chooses.
    id: 'comment.saveAttachment',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowDownload',
    milestone: 'M6',
    shipped: true,
  },
  {
    // The comment menus' Flatten (M6-09): the selected comments, no dialog.
    id: 'comment.flattenSelected',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'LayerDiagonal',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'comment.setStatus',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'CheckmarkCircle',
    milestone: 'M3',
    shipped: true, // M3-12
  },
  {
    id: 'comment.copyStyle',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'PaintBrush',
    milestone: 'M3',
    shipped: true, // M3-10
  },
  {
    id: 'comment.applyStyle',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'PaintBrushArrowDown',
    milestone: 'M3',
    shipped: true, // M3-10
  },
  {
    id: 'comment.copyComments',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Copy',
    milestone: 'M4',
    shipped: true, // M4-21
  },
  {
    id: 'comment.pasteComments',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ClipboardPaste',
    milestone: 'M4',
    shipped: true, // M4-21
  },
  {
    id: 'comment.pasteToOriginal',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ClipboardArrowRight',
    milestone: 'M4',
    shipped: true, // M4-21
  },
  {
    id: 'measure.distance',
    tab: 'measure',
    group: 'measure',
    size: 'large',
    fluent: 'Ruler',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-16
  },
  {
    id: 'measure.perimeter',
    tab: 'measure',
    group: 'measure',
    size: 'large',
    fluent: 'Pentagon',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-16
    custom: 'measure.perimeter', // M3-06
  },
  {
    id: 'measure.area',
    tab: 'measure',
    group: 'measure',
    size: 'large',
    fluent: 'Pentagon',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-16
    custom: 'measure.area', // M3-06
  },
  {
    id: 'measure.calibrate',
    tab: 'measure',
    group: 'scale',
    size: 'large',
    fluent: 'Ruler',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-15
    custom: 'measure.calibrate', // M3-06
  },
  {
    id: 'measure.setScale',
    tab: 'measure',
    group: 'scale',
    size: 'large',
    fluent: 'RatioOneToOne',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-15
    custom: 'measure.setScale', // M3-06
  },
  {
    id: 'measure.scaleViewport',
    tab: 'measure',
    group: 'scale',
    size: 'large',
    fluent: 'SelectObject',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-17
    custom: 'measure.scaleViewport', // M3-06
  },
  {
    id: 'measure.units',
    tab: 'measure',
    group: 'settings',
    size: 'small',
    fluent: 'NumberSymbol',
    milestone: 'M3',
    shipped: true, // M3-15
  },
  {
    id: 'measure.snapping',
    tab: 'measure',
    group: 'snap',
    size: 'small',
    fluent: 'Target',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-18
    custom: 'measure.snapping', // M3-06
  },
  {
    id: 'measure.snapEndpoint',
    tab: 'measure',
    group: 'snap',
    size: 'small',
    fluent: 'Square',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-18
    custom: 'measure.snapEndpoint', // M3-06
  },
  {
    id: 'measure.snapMidpoint',
    tab: 'measure',
    group: 'snap',
    size: 'small',
    fluent: 'Triangle',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-18
    custom: 'measure.snapMidpoint', // M3-06
  },
  {
    id: 'measure.snapIntersection',
    tab: 'measure',
    group: 'snap',
    size: 'small',
    fluent: 'Dismiss',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-18
    custom: 'measure.snapIntersection', // M3-06
  },
  {
    id: 'measure.snapNearest',
    tab: 'measure',
    group: 'snap',
    size: 'small',
    fluent: 'Circle',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-18
    custom: 'measure.snapNearest', // M3-06
  },
  {
    id: 'organize.insertBlank',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'DocumentOnePageAdd',
    milestone: 'M4',
    shipped: true, // M4-09
  },
  {
    id: 'organize.insertFromFile',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'DocumentAdd',
    milestone: 'M4',
    shipped: true, // M4-11
  },
  {
    id: 'organize.delete',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'DocumentDismiss',
    milestone: 'M4',
    shipped: true, // M4-09
  },
  {
    id: 'organize.move',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'ReOrder',
    milestone: 'M4',
    shipped: true, // M4-10
  },
  {
    id: 'organize.extract',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'DocumentArrowRight',
    milestone: 'M4',
    shipped: true, // M4-11
  },
  {
    id: 'organize.merge',
    tab: 'organize',
    group: 'pages',
    size: 'large',
    fluent: 'DocumentMultiple',
    milestone: 'M4',
    shipped: true, // M4-11
  },
  {
    id: 'organize.rotateCw',
    tab: 'organize',
    group: 'transform',
    size: 'large',
    fluent: 'RotateRight',
    milestone: 'M4',
    shipped: true, // M4-09
  },
  {
    id: 'organize.rotateCcw',
    tab: 'organize',
    group: 'transform',
    size: 'large',
    fluent: 'RotateLeft',
    milestone: 'M4',
    shipped: true, // M4-09
  },
  {
    id: 'convert.text',
    tab: 'convert',
    group: 'export',
    size: 'large',
    fluent: 'DocumentText',
    milestone: 'M4',
    shipped: true, // M4-05
  },
  {
    id: 'convert.markdown',
    tab: 'convert',
    group: 'export',
    size: 'large',
    fluent: 'Markdown',
    milestone: 'M4',
    shipped: true, // M4-05
  },
  {
    id: 'convert.html',
    tab: 'convert',
    group: 'export',
    size: 'large',
    fluent: 'WebAsset',
    milestone: 'M4',
    shipped: true, // M4-05
  },
  {
    id: 'convert.word',
    tab: 'convert',
    group: 'export',
    size: 'large',
    fluent: 'DocumentEdit',
    milestone: 'M4',
    shipped: true, // M4-07
    custom: 'convert.word', // M4-03
  },
  {
    id: 'convert.images',
    tab: 'convert',
    group: 'export',
    size: 'large',
    fluent: 'ImageMultiple',
    milestone: 'M4',
    shipped: true, // M4-06
  },
  {
    id: 'convert.expressExtract',
    tab: 'convert',
    group: 'tablesBeta',
    size: 'large',
    fluent: 'TableLightning',
    milestone: 'M4',
    shipped: true, // M4-13
  },
  {
    id: 'convert.reviewExtract',
    tab: 'convert',
    group: 'tablesBeta',
    size: 'large',
    fluent: 'TableEdit',
    milestone: 'M4',
    shipped: true, // M4-14
  },
  {
    id: 'convert.tableTemplates',
    tab: 'convert',
    group: 'tablesBeta',
    size: 'large',
    fluent: 'TableSettings',
    milestone: 'M4',
    shipped: true, // M4-15
  },
  {
    id: 'convert.ocr',
    tab: 'convert',
    group: 'ocr',
    size: 'large',
    fluent: 'ScanText',
    milestone: 'M5', // ADR-020, M5-04
  },
  {
    id: 'protect.markRedaction',
    tab: 'protect',
    group: 'redact',
    size: 'large',
    fluent: 'TextStrikethrough',
    milestone: 'M4',
    toggle: true,
    custom: 'protect.markRedaction', // M4-03
    shipped: true, // M4-16
  },
  {
    id: 'protect.markRedactionArea',
    tab: 'protect',
    group: 'redact',
    size: 'large',
    fluent: 'RectangleLandscape',
    milestone: 'M4',
    toggle: true,
    custom: 'protect.markRedactionArea', // M4-03
    shipped: true, // M4-16
  },
  {
    id: 'protect.applyRedactions',
    tab: 'protect',
    group: 'redact',
    size: 'large',
    fluent: 'CheckmarkCircle',
    milestone: 'M4',
    custom: 'protect.applyRedactions', // M4-03
    shipped: true, // M4-18
  },
  {
    id: 'protect.redactionList',
    tab: 'protect',
    group: 'redact',
    size: 'large',
    fluent: 'TextBulletListSquare',
    milestone: 'M4',
    toggle: true,
    shipped: true, // M4-16
  },
  {
    id: 'protect.securityInfo',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'LockShield',
    milestone: 'M2',
    shipped: true, // M2-12
  },
  {
    id: 'protect.unlock',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'LockOpen',
    milestone: 'M2',
    shipped: true, // M2-03
  },
  {
    // Password Security (M6-12, D-40 a): open and permissions passwords, AES-256.
    id: 'protect.passwordSecurity',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'Password',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'protect.removeSecurity',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'ShieldDismiss',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'protect.signatures',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'Signature',
    milestone: 'M2',
    shipped: true, // M2-13
  },
  {
    // Sign Document (M6-13, D-40 b): visual signatures and initials, not certificate signing.
    id: 'protect.signDocument',
    tab: 'protect',
    group: 'sign',
    size: 'large',
    fluent: 'DocumentSignature',
    milestone: 'M6',
    shipped: true,
  },
  // Form tab (M6-14, ADR-021 D-36 / D-39): Select Fields, the five field tools
  // (@embedpdf/plugin-form) and Highlight Fields. Fields need modify + annotate.
  {
    id: 'form.selectFields',
    tab: 'form',
    group: 'tools',
    size: 'large',
    fluent: 'Form',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.textField',
    tab: 'form',
    group: 'fields',
    size: 'large',
    fluent: 'TextField',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.checkBox',
    tab: 'form',
    group: 'fields',
    size: 'large',
    fluent: 'CheckboxChecked',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.radioButton',
    tab: 'form',
    group: 'fields',
    size: 'large',
    fluent: 'RadioButton',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.listBox',
    tab: 'form',
    group: 'fields',
    size: 'large',
    fluent: 'TextBulletListSquare',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.dropdown',
    tab: 'form',
    group: 'fields',
    size: 'large',
    fluent: 'TextboxMore',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'form.highlightFields',
    tab: 'form',
    group: 'view',
    size: 'large',
    fluent: 'Highlight',
    milestone: 'M6',
    shipped: true,
    toggle: true,
  },
  {
    id: 'help.help',
    tab: 'help',
    group: 'help',
    size: 'large',
    fluent: 'QuestionCircle',
    milestone: 'M2',
    shipped: true, // M2-17
  },
  {
    id: 'help.shortcuts',
    tab: 'help',
    group: 'help',
    size: 'large',
    fluent: 'Keyboard',
    milestone: 'M1',
  },
  {
    id: 'help.errorReport',
    tab: 'help',
    group: 'help',
    size: 'large',
    fluent: 'Bug',
    milestone: 'M2',
    shipped: true, // M2-17
  },
  {
    id: 'help.updates',
    tab: 'help',
    group: 'help',
    size: 'large',
    fluent: 'ArrowSync',
    milestone: 'M1',
  },
  {
    id: 'help.clearData',
    tab: 'help',
    group: 'help',
    size: 'large',
    fluent: 'Delete',
    milestone: 'M1',
  },
  {
    id: 'rail.bookmarks',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'Bookmark',
    milestone: 'M2',
    toggle: true,
    shipped: true, // M2-10
  },
  {
    id: 'rail.thumbnails',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'SlideMultiple',
    milestone: 'M2',
    toggle: true,
    shipped: true, // M2-08
  },
  {
    id: 'rail.comments',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'CommentMultiple',
    milestone: 'M3',
    toggle: true,
    shipped: true, // M3-11
  },
  {
    id: 'rail.attachments',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'Attach',
    milestone: 'M2',
    toggle: true,
    shipped: true, // M2-11
  },
  {
    id: 'rail.signatures',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'Signature',
    milestone: 'M2',
    shipped: true, // M2-13
    toggle: true,
  },
  {
    id: 'rail.search',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'Search',
    milestone: 'M2',
    toggle: true,
    shipped: true, // M2-09
  },
  {
    id: 'rail.layers',
    tab: 'rail',
    group: 'panes',
    size: 'small',
    fluent: 'Layer',
    milestone: 'M2',
    toggle: true,
    shipped: true, // M2-11 (list only, ADR-012 d5)
  },
  // Top bar (M6-01, ADR-021 D-35): the OpenEngTools home link, the GitHub
  // issue link and full screen, at the right end of the ribbon's tab row.
  {
    id: 'app.home',
    tab: 'topBar',
    group: 'topBar',
    size: 'small',
    fluent: 'Home',
    milestone: 'M6',
    shipped: true, // M6-01
  },
  {
    id: 'app.reportIssue',
    tab: 'topBar',
    group: 'topBar',
    size: 'small',
    fluent: 'Bug',
    milestone: 'M6',
    shipped: true, // M6-01
  },
  {
    id: 'view.fullScreen',
    tab: 'topBar',
    group: 'topBar',
    size: 'small',
    fluent: 'FullScreenMaximize',
    milestone: 'M6',
    shipped: true, // M6-01
  },
  {
    id: 'view.exitFullScreen',
    tab: 'topBar',
    group: 'topBar',
    size: 'small',
    fluent: 'FullScreenMinimize',
    milestone: 'M6',
    shipped: true, // M6-01: the full-screen button while full screen is on
  },
  // Context menus (M6-02, ADR-021 D-38): the edit commands behind Ctrl+X/C/V/A
  // and the menus' Properties item; labels, icons, shortcuts and disabled
  // reasons come from here like any ribbon command.
  {
    id: 'edit.cut',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Cut',
    milestone: 'M6',
    shipped: true, // M6-02: Ctrl+X, the comment menu
  },
  {
    id: 'edit.copy',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Copy',
    milestone: 'M6',
    shipped: true, // M6-02: Ctrl+C (text or comments), the comment menu
  },
  {
    id: 'edit.paste',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ClipboardPaste',
    milestone: 'M6',
    shipped: true, // M6-02: Ctrl+V, the menus (at the pointer)
  },
  {
    id: 'edit.selectAll',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'SelectAllOn',
    milestone: 'M6',
    shipped: true, // M6-02: Ctrl+A, the page menu
  },
  {
    id: 'edit.properties',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Info',
    milestone: 'M6',
    shipped: true, // M6-02: opens the Properties pane
  },
  // Comment flags, review mark and tool defaults in the comment menu (M6-06, D-37, D-38 f).
  {
    id: 'comment.toggleLocked',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'LockClosed',
    toggle: true,
    milestone: 'M6',
    shipped: true, // M6-06: the comment menu; the Properties pane's Locked
  },
  {
    id: 'comment.togglePrintable',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Print',
    toggle: true,
    milestone: 'M6',
    shipped: true, // M6-06: the comment menu; the Properties pane's Printable
  },
  {
    id: 'comment.toggleMarked',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'CheckmarkSquare',
    toggle: true,
    milestone: 'M6',
    shipped: true, // M6-06: the reviewer's own mark (/StateModel /Marked)
  },
  {
    id: 'comment.makeDefault',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'PaintBrushArrowDown',
    milestone: 'M6',
    shipped: true, // M6-06: the comment's style becomes its tool's defaults
  },
  // The Bookmarks pane's toolbar and menu (M6-11, §7.15, ADR-022 decision 5).
  {
    id: 'bookmark.goTo',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowEnter',
    milestone: 'M6',
    shipped: true, // Enter: its destination
  },
  {
    id: 'bookmark.new',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'BookmarkAdd',
    milestone: 'M6',
    shipped: true, // after the focused one, from the current view
  },
  {
    id: 'bookmark.newChild',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'BookmarkMultiple',
    milestone: 'M6',
    shipped: true, // the last child of the focused one
  },
  {
    id: 'bookmark.cut',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Cut',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.copy',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Copy',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.paste',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ClipboardPaste',
    milestone: 'M6',
    shipped: true, // after the focused one
  },
  {
    id: 'bookmark.delete',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Delete',
    milestone: 'M6',
    shipped: true, // with everything in it
  },
  {
    id: 'bookmark.deleteKeepChildren',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'DeleteArrowBack',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.deleteChildren',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'DeleteLines',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.expandAll',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowExpandAll',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.collapseAll',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowCollapseAll',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.rename',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Rename',
    milestone: 'M6',
    shipped: true, // F2: in place
  },
  {
    id: 'bookmark.setDestination',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'TargetArrow',
    milestone: 'M6',
    shipped: true, // the current view
  },
  {
    id: 'bookmark.moveUp',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowUp',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.moveDown',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'ArrowDown',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.promote',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'TextIndentDecrease',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.demote',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'TextIndentIncrease',
    milestone: 'M6',
    shipped: true,
  },
  {
    id: 'bookmark.properties',
    tab: 'menu',
    group: 'menu',
    size: 'small',
    fluent: 'Info',
    milestone: 'M6',
    shipped: true, // title, colour, style, destination
  },
  {
    id: 'status.readyOffline',
    tab: 'status',
    group: 'status',
    size: 'small',
    fluent: 'CloudCheckmark',
    milestone: 'M1',
  },
  {
    id: 'status.preparingOffline',
    tab: 'status',
    group: 'status',
    size: 'small',
    fluent: 'ArrowDownload',
    milestone: 'M1',
  },
  {
    id: 'status.updateReady',
    tab: 'status',
    group: 'status',
    size: 'small',
    fluent: 'ArrowSync',
    milestone: 'M1',
  },
];

export const isAvailable = (c: CommandDef): boolean =>
  AVAILABLE_MILESTONES.includes(c.milestone) || c.shipped === true;
