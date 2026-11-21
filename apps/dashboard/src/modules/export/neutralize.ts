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
 * Every field of every export passes through `neutralizeCell` exactly once (`csv.ts`); no
 * other module escapes CSV content. No universal mitigation exists — the leading tab stays
 * part of the data on reimport — and that residual is disclosed in the artefact's metadata
 * record rather than hidden here.
 */

/**
 * The character placed before a neutralised value.
 *
 * A leading tab keeps a spreadsheet from reading the cell text as a formula, which is the
 * mitigation OWASP records for formula injection; the tab remains part of the field.
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
 * Whether `value` holds a formula trigger at any position where a spreadsheet could begin
 * a cell. An empty value never needs neutralising.
 */
export function requiresNeutralisation(value: string): boolean {
  if (isDangerousAt(value, 0)) {
    return true;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const opensCell = codeUnit === CARRIAGE_RETURN || codeUnit === LINE_FEED;

    // A spreadsheet reads a line break inside a quoted field as the start of a new row, so
    // the character after a CR or LF opens a cell even though this reader sees one value.
    // Testing only the first character would leave "note\r\n=cmd" executable. A CRLF run
    // needs no special case: the LF that follows the CR is itself a trigger, so the run is
    // caught either at the CR or at the LF.
    if (opensCell && isDangerousAt(value, index + 1)) {
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
 * Renders `value` as one inert, fully quoted CSV field.
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
  const neutralised = requiresNeutralisation(value) ? `${NEUTRALISER_PREFIX}${value}` : value;

  return quoteField(neutralised);
}
