/**
 * Inline SVG icons. No icon dependency: a package would be a bundle cost and a CSP decision for a
 * dozen paths. Every icon is `currentColor` and 1em-relative, inheriting the control's colour and
 * type scale, and none is ever the only label — each sits inside a control with an `aria-label`,
 * `aria-hidden` keeping the glyph out of the accessibility tree.
 */

/**
 * The four sizes anything outside this file may ask for, so a glyph size is a NAME rather than a
 * pair of literals at every call site. `em` for the two inside type, tracking the control's size;
 * `rem` for the two that sit beside their own label or in no control at all. INLINE beside 13px
 * label text · FAB the one 24px glyph · TAB above a tab's word, where the glyph carries the row and
 * must not track the 13px caption · DISPLAY the empty board's mark.
 */
export const ICON_SIZE = {
  inline: { width: '1em', height: '1em' },
  fab: { width: '1.5em', height: '1.5em' },
  tab: { width: '1.375rem', height: '1.375rem' },
  display: { width: '2rem', height: '2rem' },
}

const base = {
  width: '1.25em',
  height: '1.25em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function GearIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

export function PencilIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
    </svg>
  )
}

export function CloseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function ChevronRightIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

export function UndoIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 1 0 3.5-7.1" />
      <path d="M3 4v5h5" />
    </svg>
  )
}

/** The unchecked box and the checked one, so the control never changes size. */
export function CircleIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  )
}

export function CheckCircleIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </svg>
  )
}

/** Two interlocking rings under a stone setting: the app's own mark. `scripts/make-icons.js`
    rasterises the same geometry and `index.html` draws it inline as the favicon, in the same
    24-unit box; all three must agree, or the installed app and the screen it opens carry
    different logos. */
export function RingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="14" r="6" />
      <circle cx="15" cy="14" r="6" />
      <path d="M15 4.5 12 8l-3-3.5 1.6-1.5h2.8Z" />
    </svg>
  )
}

/* ---- The two tabs and the notes toolbar -------------------------------- Each sits beside or under
   its own word: a tab carries a label and every toolbar button an `aria-label`, so none of
   these is ever the only thing naming the control. The two letters are drawn as outlines like every
   other glyph here rather than set as type — a `<text>` element would resolve through the font stack
   and land at a different weight in Hiragino than in SF Pro. */

/** The plan: a tick against two lines. Distinct from `BulletsIcon` below, which is dots. */
export function ChecklistIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m3.5 7.5 2 2 3.5-4" />
      <path d="m3.5 16.5 2 2 3.5-4" />
      <path d="M12.5 8h8M12.5 17h8" />
    </svg>
  )
}

/** The notes: a bound book, its spine drawn. Not `DocumentIcon`'s single sheet, which is the
    Paperwork category's glyph and would put the same shape on a tab and on a row. */
export function NotebookIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 3.5h13v17h-13Z" />
      <path d="M9.5 3.5v17" />
      <path d="M12.5 8.5h4M12.5 12h4" />
    </svg>
  )
}

/** Bold, as a B. */
export function BoldIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 4.5h5.5a3.75 3.75 0 0 1 0 7.5H7.5Z" />
      <path d="M7.5 12h6.25a3.75 3.75 0 0 1 0 7.5H7.5Z" />
    </svg>
  )
}

/** A bullet list. The dots are filled: an outlined 2px circle at this size is a smudge. */
export function BulletsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="5" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.5 7h11M9.5 12h11M9.5 17h11" />
    </svg>
  )
}

/** A heading, as an H. */
export function HeadingIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 4.5v15M18 4.5v15M6 12h12" />
    </svg>
  )
}

/** Italic, as a slanted I with its serifs — a bare slash would read as "no" or "divide". */
export function ItalicIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4.5h7M7 19.5h7M14.5 4.5 9.5 19.5" />
    </svg>
  )
}

/* ---- The categories ---------------------------------------------------- One glyph per category,
   and not one colour: colour follows STATE and a row carries exactly one coloured mark, so fourteen
   hues would make that mark carry two claims. Shape costs no contrast and survives greyscale. Every
   metaphor works for an English and a Japanese reader, which rules out a currency sign for Budget,
   a church for Venue and a cake for Food. */

function WalletIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="M20.5 11h-3.4a2 2 0 0 0 0 4h3.4" />
    </svg>
  )
}

function PavilionIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 10 12 4.5 21 10" />
      <path d="M6 10v8.5M12 10v8.5M18 10v8.5" />
      <path d="M3.5 18.5h17" />
    </svg>
  )
}

function GuestsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9.5" cy="8.5" r="3.25" />
      <path d="M4 19.5c0-3 2.5-5.25 5.5-5.25s5.5 2.25 5.5 5.25" />
      <path d="M16 6.4a3.25 3.25 0 0 1 0 6.2M17.2 14.6c1.9.7 2.8 2.5 2.8 4.9" />
    </svg>
  )
}

function StorefrontIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9.5 4.8 5.5h14.4L21 9.5Z" />
      <path d="M4.5 9.5V19h15V9.5" />
      <path d="M10 19v-5.5h4V19" />
    </svg>
  )
}

function HangerIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 10.2V8.4a2.1 2.1 0 1 1 2.1 2.1" />
      <path d="M12 10.2 4 15.9a1 1 0 0 0 .6 1.8h14.8a1 1 0 0 0 .6-1.8L12 10.2Z" />
    </svg>
  )
}

function BowlIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
      <path d="M7 20h10" />
      <path d="M10 8.5c0-1.4 1.2-1.7 1.2-3.1M14 8.5c0-1.4 1.2-1.7 1.2-3.1" />
    </svg>
  )
}

function EnvelopeIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 6.5h17v11h-17z" />
      <path d="m3.5 7.5 8.5 6.2 8.5-6.2" />
    </svg>
  )
}

function CameraIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 8.5h2.7l1.5-2.2h6.6l1.5 2.2h2.7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  )
}

/** Two quavers, for Music. Named for the notation, and not `Notes` — the notes DOCUMENT is a tab of
    its own, and one word for both would put the wrong glyph on it. */
function QuaverIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="17.5" r="2.4" />
      <circle cx="17.5" cy="15.5" r="2.4" />
      <path d="M10.4 17.5V7.2l9.5-2.2v10.5" />
    </svg>
  )
}

/** Scissors, for Beauty: the salon is what the category holds. Not a hand mirror, which is the
    Venus symbol. */
function ScissorsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="6.2" cy="18" r="2.6" />
      <circle cx="17.8" cy="18" r="2.6" />
      <path d="M16.3 15.8 7.5 4.5M7.7 15.8 16.5 4.5" />
    </svg>
  )
}

/** The bow makes this a gift: the lid seam plus the ribbon read as two drawers. */
function GiftIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 9C9.8 9 7.6 8.4 7.6 7 7.6 5.6 10.4 6.2 12 9Z" />
      <path d="M12 9c2.2 0 4.4-.6 4.4-2 0-1.4-2.8-.8-4.4 2Z" />
      <path d="M3.8 9h16.4v3.6H3.8z" />
      <path d="M5.4 12.6V20h13.2v-7.4M12 9v11" />
    </svg>
  )
}

function DocumentIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 3.5h7L18 8v12.5H6.5Z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9.5 12.5h5M9.5 16h5" />
    </svg>
  )
}

function PaperPlaneIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21.5 3.5 2.5 11.9l7.7 2.5 2.4 7.6Z" />
      <path d="M21.5 3.5 10.2 14.4" />
    </svg>
  )
}

function TagIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.6 10.9 11 4.5h6.3a2.2 2.2 0 0 1 2.2 2.2V13l-6.4 6.4a2 2 0 0 1-2.8 0l-5.7-5.7a2 2 0 0 1 0-2.8Z" />
      <circle cx="15.6" cy="8.4" r="1.4" />
    </svg>
  )
}

/** Category -> glyph, keyed by the LOWERCASED name to match the way `category.<lowercased>` is
    translated. A category this map lacks returns nothing and the chip prints the word alone: the
    spreadsheet decides what a category is, and this must never decide whether one can be shown. */
const CATEGORY_ICONS = {
  budget: WalletIcon,
  venue: PavilionIcon,
  guests: GuestsIcon,
  vendors: StorefrontIcon,
  attire: HangerIcon,
  food: BowlIcon,
  stationery: EnvelopeIcon,
  photo: CameraIcon,
  music: QuaverIcon,
  beauty: ScissorsIcon,
  gifts: GiftIcon,
  paperwork: DocumentIcon,
  honeymoon: PaperPlaneIcon,
  other: TagIcon,
}

/** The glyph for a category, or nothing at all — never a fallback glyph, which would put a claim on
    an unknown category nobody made. It renders exactly as typed instead. */
export function CategoryIcon({ name, ...props }) {
  const Glyph = CATEGORY_ICONS[String(name ?? '').trim().toLowerCase()]
  return Glyph ? <Glyph {...props} /> : null
}
