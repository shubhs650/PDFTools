// M0-S6 command inventory (ARCHITECTURE §5–§8, D-20). One entry per Rev 0
// command that needs an icon. The §8 tab list is authoritative; out-of-scope
// commands are omitted, not listed as disabled (ADR-001 B6). docs/ui-reference
// was used for grouping only; no PDF-XChange artwork is referenced (rule 15).
//
// `fluent` is the chosen Fluent UI System Icons base name (without size or
// style suffix). `custom` means we draw our own icon; `fluent` is then the
// interim fallback until the custom icon exists. Labels are English for the
// generated doc only; the app uses i18n keys (rule 11).

export type Size = 'large' | 'small';

export interface Command {
  id: string;
  tab: string;
  group: string;
  label: string;
  /** large = 32 px ribbon button (also 20 px when collapsed); small = 20 px. */
  size: Size;
  fluent: string;
  /** Why a custom icon is needed, and a one-line drawing brief. */
  custom?: string;
  note?: string;
}

const c = (
  tab: string,
  group: string,
  size: Size,
  rows: [id: string, label: string, fluent: string, extra?: { custom?: string; note?: string }][],
): Command[] =>
  rows.map(([id, label, fluent, extra]) => ({ id, tab, group, label, size, fluent, ...extra }));

export const COMMANDS: Command[] = [
  // ---- Quick access toolbar (title bar) --------------------------------------------------
  ...c('Quick access', 'Quick access', 'small', [
    ['qat.open', 'Open', 'FolderOpen'],
    ['qat.save', 'Save (Ctrl+S)', 'Save'],
    ['qat.print', 'Print', 'Print'],
    ['qat.undo', 'Undo', 'ArrowUndo'],
    ['qat.redo', 'Redo', 'ArrowRedo'],
  ]),

  // ---- File (backstage) ------------------------------------------------------------------
  ...c('File', 'Backstage', 'large', [
    ['file.open', 'Open', 'FolderOpen'],
    ['file.recent', 'Recent', 'History'],
    ['file.save', 'Save', 'Save'],
    ['file.saveAs', 'Save As', 'SaveCopy'],
    [
      'file.saveOptimized',
      'Save Optimized',
      'Save',
      { custom: 'No "optimize/compact" save glyph. Draw: Save disk + inward-arrows badge.' },
    ],
    ['file.print', 'Print', 'Print'],
    ['file.exportPrintReady', 'Export Print-Ready PDF', 'DocumentBorderPrint'],
    ['file.properties', 'Document Properties', 'DocumentBulletList'],
    ['file.settings', 'Settings', 'Settings'],
    ['file.about', 'About', 'Info'],
    ['file.privacy', 'Privacy', 'ShieldCheckmark'],
  ]),

  // ---- Home ------------------------------------------------------------------------------
  ...c('Home', 'Tools', 'large', [
    ['home.hand', 'Hand', 'HandLeft'],
    ['home.selectText', 'Select Text', 'TextT'],
    ['home.selectAnnotations', 'Select Comments', 'Cursor'],
  ]),
  ...c('Home', 'Find', 'small', [
    ['home.find', 'Find (Ctrl+F)', 'Search'],
    ['home.advancedSearch', 'Advanced Search (Ctrl+Shift+F)', 'DocumentSearch'],
  ]),
  ...c('Home', 'Forms', 'small', [['home.resetForm', 'Reset Form', 'ArrowReset']]),

  // ---- View ------------------------------------------------------------------------------
  ...c('View', 'Go To', 'small', [
    ['view.firstPage', 'First Page', 'ArrowPrevious'],
    ['view.prevPage', 'Previous Page', 'ChevronLeft'],
    ['view.nextPage', 'Next Page', 'ChevronRight'],
    ['view.lastPage', 'Last Page', 'ArrowNext'],
    ['view.prevView', 'Previous View', 'ArrowCircleLeft'],
    ['view.nextView', 'Next View', 'ArrowCircleRight'],
  ]),
  ...c('View', 'Zoom', 'small', [
    ['view.actualSize', 'Actual Size', 'RatioOneToOne'],
    ['view.fitPage', 'Fit Page', 'PageFit'],
    ['view.fitWidth', 'Fit Width', 'ArrowAutofitWidth'],
    ['view.fitVisible', 'Fit Visible', 'ArrowAutofitContent'],
    ['view.zoomIn', 'Zoom In', 'ZoomIn'],
    ['view.zoomOut', 'Zoom Out', 'ZoomOut'],
    [
      'view.loupe',
      'Loupe (nice-to-have)',
      'SearchSquare',
      { custom: 'No magnifier-window glyph. Draw: magnifier over a small window frame.' },
    ],
    [
      'view.panZoom',
      'Pan and Zoom Window (nice-to-have)',
      'WindowLocationTarget',
      { custom: 'No overview-window glyph. Draw: page with a viewport rectangle.' },
    ],
  ]),
  ...c('View', 'Page Display', 'small', [
    ['view.singlePage', 'Single Page', 'DocumentOnePage'],
    ['view.continuous', 'Continuous', 'StackVertical'],
    ['view.facing', 'Facing', 'BookOpen'],
    [
      'view.continuousFacing',
      'Continuous Facing',
      'BookOpen',
      { custom: 'No two-column scroll glyph. Draw: two stacked pairs of pages.' },
    ],
    ['view.rotateCw', 'Rotate View Clockwise', 'ArrowRotateClockwise'],
    ['view.rotateCcw', 'Rotate View Counterclockwise', 'ArrowRotateCounterclockwise'],
  ]),
  ...c('View', 'Window', 'small', [
    ['view.leftPanes', 'Panes', 'PanelLeft'],
    ['view.propertiesPane', 'Properties Pane', 'PanelRight'],
    ['view.collapseRibbon', 'Collapse Ribbon', 'PanelTopContract'],
  ]),

  // ---- Comment ---------------------------------------------------------------------------
  ...c('Comment', 'Text Markup', 'small', [
    ['comment.highlight', 'Highlight', 'Highlight'],
    ['comment.underline', 'Underline', 'TextUnderline'],
    ['comment.strikeout', 'Strikeout', 'TextStrikethrough'],
    [
      'comment.squiggly',
      'Squiggly',
      'TextUnderline',
      { custom: 'No wavy-underline glyph. Draw: TextUnderline with a wavy line.' },
    ],
    ['comment.insertText', 'Insert Text', 'TextAdd'],
    [
      'comment.replaceText',
      'Replace Text',
      'TextEditStyle',
      { custom: 'No caret-plus-strikeout glyph. Draw: struck text with an insertion caret.' },
    ],
  ]),
  ...c('Comment', 'Note', 'large', [['comment.stickyNote', 'Sticky Note', 'Note']]),
  ...c('Comment', 'Text', 'small', [
    ['comment.textBox', 'Text Box / Typewriter', 'Textbox'],
    ['comment.callout', 'Callout', 'TooltipQuote'],
  ]),
  ...c('Comment', 'Drawing', 'small', [
    ['comment.line', 'Line', 'Line'],
    ['comment.arrow', 'Arrow', 'ArrowUpRight'],
    ['comment.polyline', 'Polyline', 'LineFlowDiagonalUpRight'],
    ['comment.polygon', 'Polygon', 'Pentagon'],
    ['comment.rectangle', 'Rectangle', 'RectangleLandscape'],
    ['comment.oval', 'Oval', 'Oval'],
    [
      'comment.cloud',
      'Cloud',
      'Cloud',
      {
        custom:
          'Fluent Cloud is a weather/cloud-storage glyph. Draw: a revision cloud (scalloped rectangle outline). Named in §8.',
      },
    ],
    ['comment.pencil', 'Pencil (Ink)', 'Pen'],
    ['comment.inkHighlighter', 'Ink Highlighter', 'InkingTool'],
  ]),
  ...c('Comment', 'Stamp', 'large', [
    [
      'comment.stamp',
      'Stamp',
      'ApprovalsApp',
      {
        custom:
          'Fluent Stamp exists only in the Light style at 32 px (no Regular/Filled/Color). Draw: rubber stamp in the Regular grid.',
      },
    ],
  ]),
  ...c('Comment', 'Stamp', 'small', [
    ['comment.imageStamp', 'Image Stamp', 'ImageAdd'],
    ['comment.statusSchemes', 'Status Schemes', 'Status'],
    ['comment.link', 'Link', 'Link'],
  ]),
  ...c('Comment', 'Manage Comments', 'small', [
    ['comment.commentsPane', 'Comments Pane', 'CommentMultiple'],
    ['comment.reply', 'Reply', 'ArrowReply'],
    ['comment.setStatus', 'Set Status', 'CheckmarkCircle'],
    ['comment.filter', 'Filter Comments', 'Filter'],
    ['comment.autoNumber', 'Show Numbers on Page', 'NumberSymbolSquare'],
    ['comment.copyStyle', 'Copy Comment Style', 'PaintBrush'],
    ['comment.applyStyle', 'Apply Comment Style', 'PaintBrushArrowDown'],
    ['comment.reviewerProfile', 'Reviewer Profile', 'PersonEdit'],
    ['comment.exportAnnotations', 'Export Comments (CSV / XLSX / JSON)', 'ArrowExport'],
  ]),
  ...c('Comment', 'Manage Comments', 'large', [
    [
      'comment.exportCrs',
      'Export CRS (Excel)',
      'DocumentTableArrowRight',
      {
        custom:
          'No comment-review-sheet glyph. Draw: sheet grid + comment bubble + export arrow. Named in §8.',
      },
    ],
  ]),

  // ---- Measure ---------------------------------------------------------------------------
  ...c('Measure', 'Measure', 'large', [
    ['measure.distance', 'Distance', 'Ruler'],
    [
      'measure.perimeter',
      'Perimeter',
      'Pentagon',
      { custom: 'No measured-outline glyph. Draw: open polyline with dimension ticks.' },
    ],
    [
      'measure.area',
      'Area',
      'Pentagon',
      { custom: 'No measured-area glyph. Draw: hatched polygon with a dimension tick.' },
    ],
  ]),
  ...c('Measure', 'Scale', 'large', [
    [
      'measure.calibrate',
      'Calibrate',
      'Ruler',
      {
        custom: 'No calibration glyph. Draw: ruler with two pick points and a check. Named in §8.',
      },
    ],
    [
      'measure.setScale',
      'Set Scale',
      'RatioOneToOne',
      { custom: 'Fluent Scales is a weighing balance. Draw: "1:n" ratio badge on a sheet.' },
    ],
    [
      'measure.scaleViewport',
      'Scale Viewport',
      'SelectObject',
      {
        custom:
          'No viewport glyph. Draw: dashed region on a sheet with a "1:n" badge. Named in §8.',
      },
    ],
  ]),
  ...c('Measure', 'Settings', 'small', [['measure.units', 'Units and Precision', 'NumberSymbol']]),
  ...c('Measure', 'Snap', 'small', [
    [
      'measure.snapping',
      'Enable Snapping (also status bar)',
      'Target',
      { custom: 'No snap glyph. Draw: cursor crosshair locking onto a line endpoint.' },
    ],
    [
      'measure.snapEndpoint',
      'Snap to Endpoint',
      'Square',
      { custom: 'CAD snap marker: small square on a line end.' },
    ],
    [
      'measure.snapMidpoint',
      'Snap to Midpoint',
      'Triangle',
      { custom: 'CAD snap marker: small triangle on a line middle.' },
    ],
    [
      'measure.snapIntersection',
      'Snap to Intersection',
      'Dismiss',
      { custom: 'CAD snap marker: X on two crossing lines.' },
    ],
    [
      'measure.snapNearest',
      'Snap to Nearest',
      'Circle',
      { custom: 'CAD snap marker: hourglass/circle on a line.' },
    ],
  ]),

  // ---- Organize --------------------------------------------------------------------------
  ...c('Organize', 'Pages', 'large', [
    ['organize.insertBlank', 'Insert Blank Page', 'DocumentOnePageAdd'],
    ['organize.insertFromFile', 'Insert from File', 'DocumentAdd'],
    ['organize.delete', 'Delete Pages', 'DocumentDismiss'],
    ['organize.extract', 'Extract Pages', 'DocumentArrowRight'],
    ['organize.merge', 'Merge Files', 'DocumentMultiple'],
  ]),
  ...c('Organize', 'Transform', 'large', [
    ['organize.rotateCw', 'Rotate Pages Clockwise', 'RotateRight'],
    ['organize.rotateCcw', 'Rotate Pages Counterclockwise', 'RotateLeft'],
  ]),

  // ---- Convert ---------------------------------------------------------------------------
  ...c('Convert', 'Export', 'large', [
    ['convert.text', 'To Text', 'DocumentText'],
    ['convert.markdown', 'To Markdown', 'Markdown'],
    ['convert.html', 'To HTML', 'WebAsset'],
    [
      'convert.word',
      'To Word (Beta)',
      'DocumentEdit',
      {
        custom:
          'No generic word-processor glyph, and the Microsoft Word logo must not be used. Draw: document with a "DOCX" tag.',
      },
    ],
    ['convert.images', 'Export Images', 'ImageMultiple'],
  ]),
  ...c('Convert', 'Tables (Beta)', 'large', [
    [
      'convert.expressExtract',
      'Express Extract',
      'TableLightning',
      {
        note: '§8 lists this as custom, but Fluent TableLightning (table + lightning bolt) fits; owner to confirm.',
      },
    ],
    ['convert.reviewExtract', 'Review & Extract', 'TableEdit'],
    ['convert.tableTemplates', 'Table Templates', 'TableSettings'],
  ]),

  // ---- Protect ---------------------------------------------------------------------------
  ...c('Protect', 'Redact', 'large', [
    [
      'protect.markRedaction',
      'Mark for Redaction',
      'TextStrikethrough',
      { custom: 'No redaction glyph. Draw: text line covered by a solid black bar.' },
    ],
    [
      'protect.markRedactionArea',
      'Mark Area for Redaction',
      'RectangleLandscape',
      { custom: 'Draw: dashed rectangle with a solid black fill corner.' },
    ],
    [
      'protect.applyRedactions',
      'Apply Redactions',
      'CheckmarkCircle',
      { custom: 'Draw: black redaction bar + check badge.' },
    ],
    ['protect.redactionList', 'Pending Redactions', 'TextBulletListSquare'],
  ]),
  ...c('Protect', 'Security', 'large', [
    ['protect.securityInfo', 'Security Info', 'LockShield'],
    ['protect.unlock', 'Unlock with Owner Password', 'LockOpen'],
    ['protect.signatures', 'Signatures', 'Signature'],
  ]),

  // ---- Help ------------------------------------------------------------------------------
  ...c('Help', 'Help', 'large', [
    ['help.help', 'Help', 'QuestionCircle'],
    ['help.shortcuts', 'Keyboard Shortcuts', 'Keyboard'],
    ['help.errorReport', 'Send Error Report', 'Bug'],
    ['help.updates', 'Check for Updates', 'ArrowSync'],
    ['help.clearData', 'Clear All Local Data', 'Delete'],
  ]),

  // ---- Left rail panes (§5) and status bar ----------------------------------------------
  ...c('Left rail', 'Panes', 'small', [
    ['rail.bookmarks', 'Bookmarks', 'Bookmark'],
    ['rail.thumbnails', 'Thumbnails', 'SlideMultiple'],
    ['rail.comments', 'Comments', 'CommentMultiple'],
    ['rail.attachments', 'Attachments', 'Attach'],
    ['rail.signatures', 'Signatures', 'Signature'],
    ['rail.search', 'Search Results', 'Search'],
    ['rail.layers', 'Layers', 'Layer'],
  ]),
  ...c('Status bar', 'Status', 'small', [
    ['status.readyOffline', 'Ready offline', 'CloudCheckmark'],
    ['status.preparingOffline', 'Preparing offline', 'ArrowDownload'],
    ['status.updateReady', 'Update ready', 'ArrowSync'],
  ]),
];

/**
 * Home repeats the most used commands from other tabs (layout reference);
 * they reuse the same icons, so they add no entries.
 */
export const HOME_REUSES = [
  'view.zoomIn',
  'view.zoomOut',
  'view.fitPage',
  'view.fitWidth',
  'comment.highlight',
  'comment.textBox',
  'comment.stickyNote',
  'comment.cloud',
  'comment.stamp',
  'measure.distance',
  'organize.rotateCw',
  'protect.signatures',
];
