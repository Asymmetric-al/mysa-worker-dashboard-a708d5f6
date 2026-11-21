/** Enforces the two invariants Oxlint 1.94.0 has no rule for, as part of `bun run lint`. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const APP_SOURCE = path.join(ROOT, "apps", "dashboard", "src");

const COLOUR_DIRECTORIES = ["components", "features", "app"];
const COLOUR_EXTENSIONS = [".ts", ".tsx"];
const MONEY_DIRECTORIES = [path.join("modules", "money"), path.join("modules", "support"), path.join("modules", "export")];
const MONEY_EXTENSION = ".ts";
const MONEY_MODULE_DIRECTORY = path.join("modules", "money");

interface InvariantRule {
  readonly name: string;
  readonly pattern: RegExp;
}

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

// A candidate numeric literal, so a hex, octal or binary integer can be told apart from a fractional one.
const NUMBER_LITERAL = /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d[\d_]*)?)(?![\w$])/gu;
const NON_INTEGER_LITERAL = /\.\d|[eE]/u;
const FLOOR_CALL = /Math\.floor\s*\(/gu;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly source: string;
}

interface ScannedLine {
  /** The line with its trailing comment removed, so a quoted colour value is still read. */
  readonly code: string;
  /** The same, with every quoted span blanked, so text is never mistaken for an operator or a literal. */
  readonly bare: string;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/");
}

/** Splits one line into its code and its code with quoted spans blanked, treating a trailing `//` as a comment. */
function scanLine(line: string): ScannedLine {
  let code = "";
  let bare = "";
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (quote === null && character === "/" && line.charAt(index + 1) === "/") {
      break;
    }
    if (quote === null) {
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      }
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
    if (character === "\\") {
      code += character;
      bare += " ";
      escaped = true;
      continue;
    }
    if (character === quote) {
      quote = null;
      code += character;
      bare += character;
      continue;
    }
    code += character;
    bare += " ";
  }
  return { code, bare };
}

/** True when the code holds a numeric literal that is not an integer — a decimal point before a digit, or an exponent. */
function hasNonIntegerLiteral(bare: string): boolean {
  for (const match of bare.matchAll(NUMBER_LITERAL)) {
    const literal = match[0];
    if (literal.startsWith("0x") || literal.startsWith("0X") || literal.startsWith("0b") || literal.startsWith("0B") || literal.startsWith("0o") || literal.startsWith("0O")) {
      continue;
    }
    if (NON_INTEGER_LITERAL.test(literal)) {
      return true;
    }
  }
  return false;
}

interface FloorCall {
  readonly open: number;
  /** The index of the closing parenthesis, or `-1` when the argument continues past this line. */
  readonly close: number;
}

/** Locates every `Math.floor(…)` call on one line, so a division can be matched to the call that floors it. */
function floorCalls(bare: string): readonly FloorCall[] {
  const calls: FloorCall[] = [];
  for (const match of bare.matchAll(FLOOR_CALL)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let index = open; index < bare.length; index += 1) {
      const character = bare.charAt(index);
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    calls.push({ open, close });
  }
  return calls;
}

function insideCall(calls: readonly FloorCall[], index: number, lineLength: number): boolean {
  return calls.some((call) => index > call.open && index < (call.close === -1 ? lineLength : call.close));
}

function violation(file: string, line: number, name: string, source: string): Violation {
  return { file, line, name, source: source.trim() };
}

function colourViolations(file: string, lines: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    const { code } = scanLine(line);
    for (const rule of COLOUR_RULES) {
      if (rule.pattern.test(code)) {
        violations.push(violation(file, index + 1, rule.name, line));
      }
    }
  });
  return violations;
}

function moneyViolations(file: string, lines: readonly string[], inMoneyModule: boolean): readonly Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    const { bare } = scanLine(line);
    for (const rule of MONEY_RULES) {
      if (rule.pattern.test(bare)) {
        violations.push(violation(file, index + 1, rule.name, line));
      }
    }
    if (hasNonIntegerLiteral(bare)) {
      violations.push(violation(file, index + 1, "money-fraction-literal", line));
    }
    if (!inMoneyModule) {
      return;
    }
    for (const rule of MONEY_MODULE_RULES) {
      if (rule.pattern.test(bare)) {
        violations.push(violation(file, index + 1, rule.name, line));
      }
    }
    const calls = floorCalls(bare);
    for (const call of calls) {
      // An argument that runs past this line cannot be judged here, so it is left to the caller's own review.
      if (call.close !== -1 && !bare.slice(call.open, call.close).includes("/")) {
        violations.push(violation(file, index + 1, "money-floor-argument", line));
      }
    }
    for (let position = 0; position < bare.length; position += 1) {
      if (bare.charAt(position) === "/" && !insideCall(calls, position, bare.length)) {
        violations.push(violation(file, index + 1, "money-division", line));
        break;
      }
    }
  });
  return violations;
}

/** Every file under `directory` whose name ends in one of `extensions`, in a stable order. */
async function collectFiles(directory: string, extensions: readonly string[]): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, extensions)));
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(full);
    }
  }
  return files;
}

async function readLines(file: string): Promise<readonly string[]> {
  return (await readFile(file, "utf8")).split("\n");
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

async function main(): Promise<number> {
  let colourFiles: readonly string[];
  let moneyFiles: readonly string[];
  const violations: Violation[] = [];
  try {
    // The source root is read first: a tree that cannot be read is a failure (2), never a clean verdict (0).
    await readdir(APP_SOURCE);
    colourFiles = (await Promise.all(COLOUR_DIRECTORIES.map((directory) => collectFiles(path.join(APP_SOURCE, directory), COLOUR_EXTENSIONS)))).flat();
    moneyFiles = (await Promise.all(MONEY_DIRECTORIES.map((directory) => collectFiles(path.join(APP_SOURCE, directory), [MONEY_EXTENSION])))).flat();
    if (colourFiles.length === 0 || moneyFiles.length === 0) {
      throw new Error(`no files were found to scan (${String(colourFiles.length)} colour, ${String(moneyFiles.length)} money)`);
    }
    const moneyModuleRoot = path.join(APP_SOURCE, MONEY_MODULE_DIRECTORY) + path.sep;
    for (const file of colourFiles) {
      violations.push(...colourViolations(relative(file), await readLines(file)));
    }
    for (const file of moneyFiles) {
      violations.push(...moneyViolations(relative(file), await readLines(file), file.startsWith(moneyModuleRoot)));
    }
  } catch (error) {
    process.stderr.write(`invariant check: cannot read the application source tree under ${APP_SOURCE}: ${String(error)}\n`);
    return 2;
  }
  violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.name.localeCompare(right.name));
  for (const entry of violations) {
    process.stdout.write(`${entry.file}:${String(entry.line)}: ${entry.name}: ${entry.source}\n`);
  }
  process.stdout.write(`invariant check: ${String(colourFiles.length)} colour files, ${String(moneyFiles.length)} money files, ${String(violations.length)} violations\n`);
  return violations.length === 0 ? 0 : 1;
}

process.exitCode = await main();
