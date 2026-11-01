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
  'measure',
  'organize',
  'convert',
  'protect',
  'help',
] as const satisfies readonly CommandTab[];

/**
 * Home repeats frequent commands from other tabs with the same icons (layout
 * reference), as small buttons in Home's own groups (labels
 * `ribbon.group.home.<group>`) so the tab fits 1280 px (§8).
 */
export const HOME_REUSE_GROUPS: readonly { group: string; ids: readonly string[] }[] = [
  { group: 'zoom', ids: ['view.zoomIn', 'view.zoomOut', 'view.fitPage', 'view.fitWidth'] },
  {
    group: 'comment',
    ids: [
      'comment.highlight',
      'comment.stickyNote',
      'comment.textBox',
      'comment.cloud',
      'comment.stamp',
    ],
  },
  { group: 'measure', ids: ['measure.distance'] },
  { group: 'pages', ids: ['organize.rotateCw'] },
  { group: 'protect', ids: ['protect.signatures'] },
];

/** Every command Home repeats, in order. */
export const HOME_REUSES: readonly string[] = HOME_REUSE_GROUPS.flatMap((g) => g.ids);

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
  {
    id: 'comment.highlight',
    tab: 'comment',
    group: 'textMarkup',
    size: 'small',
    fluent: 'Highlight',
    milestone: 'M3',
    toggle: true,
    compact: true,
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
    compact: true,
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
    compact: true,
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
    compact: true,
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
    compact: true,
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
    compact: true,
    shipped: true, // M3-08
    custom: 'comment.replaceText', // M3-06
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
    id: 'comment.textBox',
    tab: 'comment',
    group: 'text',
    size: 'small',
    fluent: 'Textbox',
    milestone: 'M3',
    short: true,
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
    id: 'comment.inkHighlighter',
    tab: 'comment',
    group: 'drawing',
    size: 'small',
    fluent: 'InkingTool',
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
    group: 'comments',
    size: 'small',
    fluent: 'CommentMultiple',
    milestone: 'M3',
    shipped: true, // M3-11
  },
  {
    id: 'comment.reviewerProfile',
    tab: 'comment',
    group: 'comments',
    size: 'small',
    fluent: 'PersonEdit',
    milestone: 'M3',
    shipped: true, // M3-07
  },
  {
    id: 'comment.statusSchemes',
    tab: 'comment',
    group: 'comments',
    size: 'small',
    fluent: 'Status',
    milestone: 'M3',
    shipped: true, // M3-13
  },
  {
    id: 'comment.filter',
    tab: 'comment',
    group: 'comments',
    size: 'small',
    fluent: 'Filter',
    milestone: 'M3',
    short: true,
    shipped: true, // M3-11
  },
  {
    id: 'comment.autoNumber',
    tab: 'comment',
    group: 'comments',
    size: 'small',
    fluent: 'NumberSymbolSquare',
    milestone: 'M3',
    short: true,
    toggle: true,
    shipped: true, // M3-11
  },
  {
    id: 'comment.reply',
    tab: 'comment',
    group: 'review',
    size: 'small',
    fluent: 'ArrowReply',
    milestone: 'M3',
    shipped: true, // M3-12
  },
  {
    // A visible Delete beside Reply and Set Status (preview review OBS01): the
    // same action as the Delete key and the Comments pane.
    id: 'comment.delete',
    tab: 'comment',
    group: 'review',
    size: 'small',
    fluent: 'Delete',
    milestone: 'M3',
    short: true,
    shipped: true,
  },
  {
    id: 'comment.setStatus',
    tab: 'comment',
    group: 'review',
    size: 'small',
    fluent: 'CheckmarkCircle',
    milestone: 'M3',
    shipped: true, // M3-12
  },
  {
    id: 'comment.copyStyle',
    tab: 'comment',
    group: 'review',
    size: 'small',
    fluent: 'PaintBrush',
    milestone: 'M3',
    shipped: true, // M3-10
  },
  {
    id: 'comment.applyStyle',
    tab: 'comment',
    group: 'review',
    size: 'small',
    fluent: 'PaintBrushArrowDown',
    milestone: 'M3',
    shipped: true, // M3-10
  },
  {
    id: 'comment.importComments',
    tab: 'comment',
    group: 'transfer',
    size: 'small',
    fluent: 'ArrowImport',
    milestone: 'M4',
    short: true,
    shipped: true, // M4-20
  },
  {
    id: 'comment.exportAnnotations',
    tab: 'comment',
    group: 'transfer',
    size: 'small',
    fluent: 'ArrowExport',
    milestone: 'M4',
    short: true, // M3-Q1: annotation export is M4 (§13)
    shipped: true, // M4-08
  },
  {
    id: 'comment.copyComments',
    tab: 'comment',
    group: 'transfer',
    size: 'small',
    fluent: 'Copy',
    milestone: 'M4',
    short: true,
    shipped: true, // M4-21
  },
  {
    id: 'comment.pasteComments',
    tab: 'comment',
    group: 'transfer',
    size: 'small',
    fluent: 'ClipboardPaste',
    milestone: 'M4',
    short: true,
    shipped: true, // M4-21
  },
  {
    id: 'comment.pasteToOriginal',
    tab: 'comment',
    group: 'transfer',
    size: 'small',
    fluent: 'ClipboardArrowRight',
    milestone: 'M4',
    short: true,
    shipped: true, // M4-21
  },
  {
    id: 'comment.exportCrs',
    tab: 'comment',
    group: 'transfer',
    size: 'large',
    fluent: 'DocumentTableArrowRight',
    milestone: 'M3',
    short: true,
    shipped: true, // M3-19
    custom: 'comment.exportCrs', // M3-06
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
    id: 'protect.signatures',
    tab: 'protect',
    group: 'security',
    size: 'large',
    fluent: 'Signature',
    milestone: 'M2',
    shipped: true, // M2-13
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
