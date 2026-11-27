/** Enforces repository invariants Oxlint 1.94.0 has no rule for, as part of `bun run lint`:
 * 1. No raw colour literals outside `globals.css`.
 * 2. No floating-point money arithmetic in money/support/export modules.
 * 3. Boundary date/time arithmetic goes through `src/modules/time` only.
 * 4. No component, feature, or route derives a financial total.
 * 5. No original media filename or original media bytes reference escapes the ingestion/store boundary.
 * 6. No raw Unicode bidi control character is embedded in application source, and `content/document.ts` rejects them.
 * 7. Exactly one Tiptap editor configuration (`prose-editor.tsx`) and one static renderer (`modules/content/render.ts`).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const ROOT = path.join(import.meta.dir, "..");
const APP_SOURCE = path.join(ROOT, "apps", "dashboard", "src");
const COLOUR_DIRECTORIES = ["components", "features", "app"];
const CODE_EXTENSIONS = [".ts", ".tsx"];
const MONEY_DIRECTORIES = [path.join("modules", "money"), path.join("modules", "support"), path.join("modules", "export")];
const MONEY_EXTENSIONS = [".ts"];
const MONEY_MODULE_DIRECTORY = path.join("modules", "money");
const DOCUMENT_SCHEMA_FILE = "apps/dashboard/src/modules/content/document.ts";
const TIPTAP_EDITOR_FILE = "apps/dashboard/src/components/prose-editor.tsx";
const TIPTAP_RENDERER_FILE = "apps/dashboard/src/modules/content/render.ts";
const MEDIA_ORIGINAL_ALLOWED_PREFIXES = [
  "apps/dashboard/src/modules/media/",
  "apps/dashboard/src/modules/store/",
  "apps/dashboard/src/modules/dev-runtime/",
] as const;
const MEDIA_ORIGINAL_ALLOWED_FILES = new Set<string>([
  "apps/dashboard/src/modules/data-service/envelope.ts",
  "apps/dashboard/src/modules/data-service/mutations/content.ts",
]);
const WALL_CLOCK_UI_ALLOWED = new Set<string>([
  "apps/dashboard/src/components/dev-panel.tsx",
  "apps/dashboard/src/features/shell/copy/dev-labels.ts",
  "apps/dashboard/src/features/shell/components/viewer-preferences-provider.tsx",
]);
type InvariantRule = { readonly name: string; readonly pattern: RegExp };
const COLOUR_RULES: readonly InvariantRule[] = [
  { name: "colour-arbitrary-value", pattern: /\[#[0-9a-fA-F]{3,8}\]/ },
  { name: "colour-function", pattern: /\b(?:oklch|oklab|rgba?|hsla?)\s*\(/ },
  { name: "colour-hex", pattern: /(?<!&)#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/ },
];
const MONEY_RULES: readonly InvariantRule[] = [
  { name: "money-parse-float", pattern: /\bparseFloat\s*\(/ },
  { name: "money-to-fixed", pattern: /\.toFixed\s*\(/ },
  { name: "money-math-round", pattern: /Math\.round\s*\(/ },
];
const MONEY_MODULE_RULES: readonly InvariantRule[] = [
  { name: "money-math-ceil", pattern: /Math\.ceil\s*\(/ },
  { name: "money-math-trunc", pattern: /Math\.trunc\s*\(/ },
];
const TIME_BOUNDARY_MODULE_RULES: readonly InvariantRule[] = [
  { name: "time-boundary-date-ctor", pattern: /\bnew\s+Date\s*\(/ },
  { name: "time-boundary-date-parse", pattern: /\bDate\.parse\s*\(/ },
  { name: "time-boundary-elapsed-day", pattern: /\b(?:86_?400(?:_?000)?|604_?800(?:_?000)?)\b/ },
];
const TIME_BOUNDARY_UI_RULES: readonly InvariantRule[] = [
  { name: "time-boundary-date-ctor", pattern: /\bnew\s+Date\s*\(/ },
  { name: "time-boundary-elapsed-day", pattern: /\b(?:86_?400(?:_?000)?|604_?800(?:_?000)?)\b/ },
];
const UI_TOTAL_RULES: readonly InvariantRule[] = [
  { name: "ui-financial-total-helper", pattern: /\b(?:addMinor|subtractMinor|sumMinor)\b/ },
  { name: "ui-financial-total-reduce", pattern: /\.reduce\s*\([^)]*minorUnits\b/ },
];
const MEDIA_ORIGINAL_RULES: readonly InvariantRule[] = [
  { name: "media-original-ref-leak", pattern: /\bsourceOriginalRef\b/ },
  { name: "media-original-path-leak", pattern: /media-originals/ },
];
const BIDI_CONTROL_LITERAL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const TIPTAP_IMPORT_PATTERN = /from\s+["'](@tiptap\/[^"']+)["']/;
const NUMBER_LITERAL = /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d[\d_]*)?)(?![\w$])/gu; // A candidate numeric literal, so a hex, octal or binary integer can be told apart from a fractional one.
const ADMITTED_QUOTES = new Set(['"', "'", "`"]);
type Violation = { readonly file: string; readonly line: number; readonly name: string; readonly source: string };
interface ScannedLine {
  /** The line with its trailing comment removed, so a quoted colour value is still read. */ readonly code: string;
  /** The same, with every quoted span blanked, so text is never mistaken for an operator or a literal. */ readonly bare: string;
}
const isCommentLine = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/u.test(line);
/** Splits one line into its code and its code with quoted spans blanked, treating a trailing `//` as a comment. */ function scanLine(line: string): ScannedLine {
  let code = "";
  let bare = "";
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (quote === null && character === "/" && line.charAt(index + 1) === "/") break;
    if (quote === null && ADMITTED_QUOTES.has(character)) {
      quote = character;
      code += character;
      bare += character;
      continue;
    }
    if (escaped) {
      code += character;
      bare += " ";
      escaped = false;
      continue;
    }
    if (quote !== null && character === "\\") {
      code += character;
      bare += " ";
      escaped = true;
      continue;
    }
    if (quote !== null && character === quote) {
      quote = null;
      code += character;
      bare += character;
      continue;
    }
    code += character;
    bare += quote === null ? character : " ";
  }
  return { code, bare };
}
/** True when the code holds a numeric literal that is not an integer — a decimal point before a digit, or an exponent. */ const hasNonIntegerLiteral = (bare: string): boolean => [...bare.matchAll(NUMBER_LITERAL)].some((match) => !/^0[xXbBoO]/u.test(match[0]) && /\.\d|[eE]/u.test(match[0]));
interface FloorCall {
  readonly open: number;
  /** The index of the closing parenthesis, or `-1` when the argument continues past this line. */ readonly close: number;
}
/** Locates every `Math.floor(…)` call on one line, so a division can be matched to the call that floors it. */ function floorCalls(bare: string): readonly FloorCall[] {
  const calls: FloorCall[] = [];
  for (const match of bare.matchAll(/Math\.floor\s*\(/gu)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let index = open; index < bare.length; index += 1) {
      const character = bare.charAt(index);
      if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0) {
        close = index;
        break;
      }
    }
    calls.push({ open, close });
  }
  return calls;
}
const insideCall = (calls: readonly FloorCall[], index: number, lineLength: number): boolean => calls.some((call) => index > call.open && index < (call.close === -1 ? lineLength : call.close));
const violation = (file: string, line: number, name: string, source: string): Violation => ({ file, line, name, source: source.trim() });
const rulesFired = (rules: readonly InvariantRule[], text: string): readonly string[] => rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
function colourViolations(file: string, lines: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const { code } = scanLine(line);
    for (const name of rulesFired(COLOUR_RULES, code)) violations.push(violation(file, index + 1, name, line));
  });
  return violations;
}
function moneyViolations(file: string, lines: readonly string[], inMoneyModule: boolean): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const { bare } = scanLine(line);
    for (const name of rulesFired(MONEY_RULES, bare)) violations.push(violation(file, index + 1, name, line));
    if (hasNonIntegerLiteral(bare)) violations.push(violation(file, index + 1, "money-fraction-literal", line));
    if (!inMoneyModule) return;
    for (const name of rulesFired(MONEY_MODULE_RULES, bare)) violations.push(violation(file, index + 1, name, line));
    const calls = floorCalls(bare);
    for (const call of calls) if (call.close !== -1 && !bare.slice(call.open, call.close).includes("/")) violations.push(violation(file, index + 1, "money-floor-argument", line)); // An argument that runs past this line cannot be judged here, so it is left to the caller's own review.
    for (let position = 0; position < bare.length; position += 1) {
      if (bare.charAt(position) !== "/" || insideCall(calls, position, bare.length)) continue;
      violations.push(violation(file, index + 1, "money-division", line));
      break;
    }
  });
  return violations;
}
function timeBoundaryViolations(file: string, lines: readonly string[]): readonly Violation[] {
  if (file.startsWith("apps/dashboard/src/modules/time/") || WALL_CLOCK_UI_ALLOWED.has(file)) return [];
  const inModules = file.startsWith("apps/dashboard/src/modules/");
  const inUi = file.startsWith("apps/dashboard/src/components/") || file.startsWith("apps/dashboard/src/features/") || file.startsWith("apps/dashboard/src/app/");
  if (!inModules && !inUi) return [];
  const rules = inModules ? TIME_BOUNDARY_MODULE_RULES : TIME_BOUNDARY_UI_RULES;
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const { bare } = scanLine(line);
    for (const name of rulesFired(rules, bare)) violations.push(violation(file, index + 1, name, line));
  });
  return violations;
}
function uiFinancialTotalViolations(file: string, lines: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const { bare } = scanLine(line);
    for (const name of rulesFired(UI_TOTAL_RULES, bare)) violations.push(violation(file, index + 1, name, line));
  });
  return violations;
}
function mediaOriginalViolations(file: string, lines: readonly string[]): readonly Violation[] {
  if (MEDIA_ORIGINAL_ALLOWED_FILES.has(file) || MEDIA_ORIGINAL_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) return [];
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const { code } = scanLine(line);
    for (const name of rulesFired(MEDIA_ORIGINAL_RULES, code)) violations.push(violation(file, index + 1, name, line));
  });
  return violations;
}
function bidiControlViolations(file: string, lines: readonly string[]): readonly Violation[] {
  if (file === DOCUMENT_SCHEMA_FILE) {
    const joined = lines.join("\n");
    if (!/BIDI_CONTROL_PATTERN\s*=\s*\/.*\\u061C.*\\u200E.*\\u200F.*\\u202A-\\u202E.*\\u2066-\\u2069.*\//u.test(joined)) {
      return [violation(file, 1, "bidi-guard-incomplete", "BIDI_CONTROL_PATTERN must reject U+061C, U+200E, U+200F, U+202A-U+202E, and U+2066-U+2069")];
    }
    return [];
  }
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (BIDI_CONTROL_LITERAL.test(line)) violations.push(violation(file, index + 1, "bidi-control-literal", line));
  });
  return violations;
}
function tiptapBoundaryViolations(file: string, lines: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const match = TIPTAP_IMPORT_PATTERN.exec(scanLine(line).code);
    if (match === null) return;
    const pkg = match[1] ?? "";
    const allowedInEditor = file === TIPTAP_EDITOR_FILE && !pkg.startsWith("@tiptap/static-renderer");
    const allowedInRenderer = file === TIPTAP_RENDERER_FILE && pkg.startsWith("@tiptap/static-renderer");
    if (!allowedInEditor && !allowedInRenderer) violations.push(violation(file, index + 1, "tiptap-single-owner", line));
  });
  return violations;
}
/** Every file under `directory` whose name ends in one of `extensions`, in a stable order. */ async function collectFiles(directory: string, extensions: readonly string[]): Promise<readonly string[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full, extensions)));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) files.push(full);
  }
  return files;
}
const readLines = async (file: string): Promise<readonly string[]> => (await readFile(file, "utf8")).split("\n");
const relative = (file: string): string => path.relative(ROOT, file).split(path.sep).join("/");
async function main(): Promise<number> {
  let colourFiles: readonly string[];
  let moneyFiles: readonly string[];
  let allSourceFiles: readonly string[];
  const violations: Violation[] = [];
  try {
    await readdir(APP_SOURCE); // The source root is read first: a tree that cannot be read is a failure (2), never a clean verdict (0).
    colourFiles = (await Promise.all(COLOUR_DIRECTORIES.map((directory) => collectFiles(path.join(APP_SOURCE, directory), CODE_EXTENSIONS)))).flat();
    moneyFiles = (await Promise.all(MONEY_DIRECTORIES.map((directory) => collectFiles(path.join(APP_SOURCE, directory), MONEY_EXTENSIONS)))).flat();
    allSourceFiles = await collectFiles(APP_SOURCE, CODE_EXTENSIONS);
    if (colourFiles.length === 0 || moneyFiles.length === 0 || allSourceFiles.length === 0) throw new Error(`no files were found to scan (${String(colourFiles.length)} colour, ${String(moneyFiles.length)} money, ${String(allSourceFiles.length)} source)`);
    const colourFileSet = new Set(colourFiles);
    const moneyFileSet = new Set(moneyFiles);
    const moneyModuleRoot = path.join(APP_SOURCE, MONEY_MODULE_DIRECTORY) + path.sep;
    for (const file of allSourceFiles) {
      const rel = relative(file);
      const lines = await readLines(file);
      if (colourFileSet.has(file)) {
        violations.push(...colourViolations(rel, lines));
        violations.push(...uiFinancialTotalViolations(rel, lines));
      }
      if (moneyFileSet.has(file)) violations.push(...moneyViolations(rel, lines, file.startsWith(moneyModuleRoot)));
      violations.push(...timeBoundaryViolations(rel, lines));
      violations.push(...mediaOriginalViolations(rel, lines));
      violations.push(...bidiControlViolations(rel, lines));
      violations.push(...tiptapBoundaryViolations(rel, lines));
    }
  } catch (error) {
    process.stderr.write(`invariant check: cannot read the application source tree under ${APP_SOURCE}: ${String(error)}\n`);
    return 2;
  }
  violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.name.localeCompare(right.name));
  for (const entry of violations) process.stdout.write(`${entry.file}:${String(entry.line)}: ${entry.name}: ${entry.source}\n`);
  process.stdout.write(`invariant check: ${String(colourFiles.length)} UI files, ${String(moneyFiles.length)} money files, ${String(allSourceFiles.length)} total source files, ${String(violations.length)} violations\n`);
  return violations.length === 0 ? 0 : 1;
}
process.exitCode = await main();
