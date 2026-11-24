export const NEUTRALISER_PREFIX = "\t";
export const DANGEROUS_LEADING_CHARS: readonly string[] = ["=", "+", "-", "@", "\t", "\r", "\n", "\uFF1D", "\uFF0B", "\uFF0D", "\uFF20"];
const DANGEROUS_CODE_POINTS: ReadonlySet<number> = new Set(DANGEROUS_LEADING_CHARS.map((character) => character.codePointAt(0)).filter((codePoint): codePoint is number => codePoint !== undefined));
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const isDangerousAt = (value: string, index: number): boolean => DANGEROUS_CODE_POINTS.has(value.codePointAt(index) ?? -1);
function opensCellAt(value: string, index: number): boolean {
  if (index === 0) return true;
  if (index < 0 || index >= value.length) return false;
  const previous = value.charCodeAt(index - 1);
  return previous === LINE_FEED ? true : previous === CARRIAGE_RETURN && value.charCodeAt(index) !== LINE_FEED;
}
const startsDangerousCell = (value: string, index: number): boolean => opensCellAt(value, index) && isDangerousAt(value, index);
/** Whether `value` holds a formula trigger at any position where a spreadsheet could begin a cell. */ export function requiresNeutralisation(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) if (startsDangerousCell(value, index)) return true;
  return false;
}
export const quoteField = (value: string): string => `"${value.replace(/"/g, '""')}"`;
/** Renders `value` as one inert, fully quoted CSV field: the neutraliser sits at every cell start whose first character a spreadsheet would read as a formula, and the value's own characters. */
export function neutralizeCell(value: string): string {
  let neutralised = "";
  let copied = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (!startsDangerousCell(value, index)) continue;
    neutralised = `${neutralised}${value.slice(copied, index)}${NEUTRALISER_PREFIX}`;
    copied = index;
  }
  return quoteField(`${neutralised}${value.slice(copied)}`);
}
