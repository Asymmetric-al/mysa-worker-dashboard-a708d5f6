/**
 * The single spreadsheet-formula neutraliser for every CSV this application produces,
 * and the only place CSV quoting is implemented.
 *
 * A spreadsheet evaluates a cell whose text opens with a formula trigger, so an export
 * built from worker-authored or source-supplied text would otherwise carry an executable
 * formula into the recipient's workbook. `neutralizeCell` makes each field inert while
 * leaving its text intact, so a name, a note or an identifier still round-trips character
 * for character.
 *
 * A cell opens at the field's first character and again after every line break inside it,
 * because a reader that re-splits the quoted field on CR or LF sees a new row there. The
 * prefix is therefore placed at each of those positions, and a neutralised multi-line value
 * carries it again after the line break.
 *
 * Every field of every export passes through `neutralizeCell` exactly once (`csv.ts`); no
 * other module escapes CSV content. No universal mitigation exists — the tab stays part of
 * the data on reimport — and that residual is disclosed in the artefact's metadata record
 * rather than hidden here.
 */

/**
 * The character placed at each cell start that would otherwise open with a formula trigger.
 *
 * A tab ahead of the trigger keeps a spreadsheet from reading that cell's text as a formula,
 * which is the mitigation OWASP records for formula injection; the tab remains part of the
 * field.
 */
export const NEUTRALISER_PREFIX = "\t";

/**
 * Every character a spreadsheet may treat as the start of a formula, in the documented
 * order: the ASCII triggers, the whitespace that can itself introduce a new cell, and the
 * full-width forms that spreadsheet software also normalises.
 *
 * This set is fixed by the export contract. It is not a parameter and no caller may weaken
 * it: a set a caller can extend, restrict or replace would not be a guarantee, so an
 * application that needs a different set needs a different contract, not a quieter export.
 */
export const DANGEROUS_LEADING_CHARS: readonly string[] = [
  "=", // U+003D
  "+", // U+002B
  "-", // U+002D
  "@", // U+0040
  "\t", // U+0009 TAB
  "\r", // U+000D CR
  "\n", // U+000A LF
  "\uFF1D", // ＝ full-width equals
  "\uFF0B", // ＋ full-width plus
  "\uFF0D", // － full-width minus
  "\uFF20", // ＠ full-width commercial at
];

const DANGEROUS_CODE_POINTS: ReadonlySet<number> = new Set(
  DANGEROUS_LEADING_CHARS.map((character) => character.codePointAt(0)).filter(
    (codePoint): codePoint is number => codePoint !== undefined,
  ),
);

const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

/** Whether the character at `index` is a formula trigger; out-of-range indexes are not. */
function isDangerousAt(value: string, index: number): boolean {
  const codePoint = value.codePointAt(index);
  return codePoint !== undefined && DANGEROUS_CODE_POINTS.has(codePoint);
}

/**
 * Whether a spreadsheet could begin a cell at `index`: the value's first character, or the
 * first character after a line break, because a reader that re-splits the quoted field on
 * CR or LF sees a new row there.
 *
 * A CRLF run ends its row at the LF, so the position holding that LF is not a cell start —
 * its predecessor is the CR — while the position after it is. Neither `requiresNeutralisation`
 * nor `neutralizeCell` decides this for itself, so detection and mitigation cannot disagree,
 * and the prefix never lands between CR and LF.
 */
function opensCellAt(value: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  if (index < 0 || index >= value.length) {
    return false;
  }

  const previous = value.charCodeAt(index - 1);

  if (previous === LINE_FEED) {
    return true;
  }

  return previous === CARRIAGE_RETURN && value.charCodeAt(index) !== LINE_FEED;
}

/** Whether a cell opens at `index` with a character a spreadsheet reads as a formula. */
function startsDangerousCell(value: string, index: number): boolean {
  return opensCellAt(value, index) && isDangerousAt(value, index);
}

/**
 * Whether `value` holds a formula trigger at any position where a spreadsheet could begin
 * a cell. An empty value never needs neutralising.
 */
export function requiresNeutralisation(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (startsDangerousCell(value, index)) {
      return true;
    }
  }

  return false;
}

/**
 * Wraps `value` in RFC 4180 quotes, doubling every inner quote and changing nothing else,
 * so the field round-trips exactly — leading zeros, emoji, right-to-left text and a
 * trailing space all survive.
 */
export function quoteField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Renders `value` as one inert, fully quoted CSV field: the neutraliser sits at every cell
 * start whose first character a spreadsheet would read as a formula, and the value's own
 * characters follow in their original order, otherwise untouched.
 */
export function neutralizeCell(value: string): string {
  // The decision is made on the logical cell value, before quoting. Quoting stops a
  // tolerant reader from splitting the field on a separator or a quote, but the spreadsheet
  // still evaluates the cell's text, so quoting everything does not remove the need to
  // neutralise — nor does it license skipping the check for a value that only becomes
  // first-in-cell once another tool re-reads the file.
  //
  // Not idempotent, deliberately: a value that already begins with the prefix is dangerous
  // in its own right and takes the prefix again ("\t=cmd" becomes "\t\t=cmd"). An
  // "already prefixed?" check would let such a value escape neutralisation, so correctness
  // rests on every field passing through this function exactly once, which `csv.ts` does.
  let neutralised = "";
  let copied = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (!startsDangerousCell(value, index)) {
      continue;
    }

    // Everything since the previous insertion is copied across in one piece, so the only
    // characters this function adds are prefixes and no original character is rewritten.
    neutralised = `${neutralised}${value.slice(copied, index)}${NEUTRALISER_PREFIX}`;
    copied = index;
  }

  return quoteField(`${neutralised}${value.slice(copied)}`);
}
