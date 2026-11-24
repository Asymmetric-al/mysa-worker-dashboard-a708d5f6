/** `bun run reset`: discards every stored session and re-seeds every seeded session from the deterministic seed, so the application starts from the known world every criterion begins at. */
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResetSummary } from "../apps/dashboard/src/modules/dev-runtime/reset";
const LABEL_WIDTH = 16;
class UsageError extends Error {}
type ParsedArguments = { readonly json: boolean };
const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PATH_COMPONENT = "[A-Za-z0-9._@%+-]+";
const ABSOLUTE_PATH = new RegExp(`(^|[\\s("'\`=:])/(?:${PATH_COMPONENT}/)*${PATH_COMPONENT}`, "g");
/** A `file://` prefix on an absolute path, which a frame built from a module URL carries. */
const FILE_SCHEME = /file:\/\/(?=\/)/g;
/** Escapes one literal string so it matches itself inside a regular expression. */
const escapeForPattern = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The absolute directories a failure must never quote, longest first: the checkout, and the directory the command was run in. */
function disclosureRoots(): readonly string[] {
  const directories = [REPOSITORY_ROOT];
  try {
    directories.push(process.cwd());
  } catch {
    // A deleted working directory cannot be named; the checkout root still hides the paths in it.
  }
  return directories
    .map((directory) => resolve(directory))
    .filter((directory) => directory.length > 1)
    .sort((left, right) => right.length - left.length);
}
/** Rewrites one root out of a message: a path below it keeps only its part inside the root, and the bare root becomes `.`, which is that directory read from itself. */
const rewriteRoot = (text: string, root: string): string =>
  text
    .split(`${root}${sep}`)
    .join("")
    .replace(new RegExp(`${escapeForPattern(root)}(?![\\w.@%+-])`, "g"), ".");
/** Rewrites every absolute path in one message or frame so it discloses nothing about this host. */
const withoutDisclosure = (text: string): string =>
  disclosureRoots()
    .reduce(rewriteRoot, text.replace(FILE_SCHEME, ""))
    .replace(ABSOLUTE_PATH, (match: string, lead: string) => `${lead}${basename(match.slice(lead.length))}`);
/** Writes one line to stderr, so a failure is never reported on the stream a success uses. */
const reportError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};
/** Reports a rejection with its message and its frames, with every absolute path rewritten. */
function reportFailure(error: unknown): void {
  if (!(error instanceof Error)) {
    reportError(withoutDisclosure(`reset failed with a non-error value: ${String(error)}`));
    return;
  }
  reportError(withoutDisclosure(error.message.length > 0 ? error.message : error.name));
  const frames = (error.stack ?? "").split("\n").slice(1).join("\n").trimEnd(); // A stack repeats the message on its first line, so only the frames beyond it are added.
  if (frames.length > 0) process.stderr.write(`${withoutDisclosure(frames)}\n`);
}
/** Reads the command line: an optional `--json` and nothing else. */
function parseArguments(argv: readonly string[]): ParsedArguments {
  let json = false;
  const refused: string[] = [];
  for (const argument of argv) {
    if (argument === "--json") json = true;
    else refused.push(argument);
  }
  if (refused.length > 0) throw new UsageError(`reset takes no arguments other than --json, and received: ${refused.join(" ")}`);
  return { json };
}
/** One aligned summary line: the label padded to the value column, then the value. */
const summaryLine = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}: ${value}\n`;
/** A count with its ids on the same line, ids sorted so two runs of one seed print identical bytes. */
function countAndIds(ids: readonly string[]): string {
  const sortedIds = [...ids].sort();
  return sortedIds.length === 0 ? "0" : `${String(sortedIds.length)}  ${sortedIds.join(", ")}`;
}
/** The human-readable block, in the order the reset is read: what was seeded, what went, then the anchor. */
const formatSummary = (summary: ResetSummary): string =>
  "Development data reset — deterministic seed restored\n" +
  summaryLine("seeded sessions", countAndIds(summary.seededSessions)) +
  summaryLine("removed sessions", countAndIds(summary.removedSessions)) +
  summaryLine("partners", String(summary.partners)) +
  summaryLine("seed instant", summary.seedInstant) +
  summaryLine("clock offset", `${String(summary.clockOffsetMs)} ms (must be 0)`);
/** The same values as one line, in the field order `ResetSummary` declares, for machine-readable evidence. */
const formatJson = (summary: ResetSummary): string => `${JSON.stringify({ seededSessions: [...summary.seededSessions].sort(), removedSessions: [...summary.removedSessions].sort(), partners: summary.partners, seedInstant: summary.seedInstant, clockOffsetMs: summary.clockOffsetMs })}\n`;
/** What separates a restored world from a command that merely exited: the clock is back at the seed instant, something was seeded, and the seeded sessions hold partners. */
const findViolation = (summary: ResetSummary): string | undefined =>
  summary.clockOffsetMs !== 0
    ? `clock offset is ${String(summary.clockOffsetMs)} ms, and a reset leaves it at 0`
    : summary.seededSessions.length === 0
      ? "seeded sessions is 0, so the seed laid down nothing"
      : !(summary.partners > 0)
        ? `partners is ${String(summary.partners)}, so the seeded sessions hold no partner records`
        : undefined;
/** Runs the one reset and reports it. */
async function main(): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      reportError(error.message);
      process.stderr.write("usage: bun scripts/reset.ts [--json]\n");
      return 2;
    }
    reportFailure(error);
    return 1;
  }
  let summary: ResetSummary;
  try {
    // Loaded in the try, not at the top of the file: the module chain resolves the store's data root as it initialises, so a working directory outside the checkout refuses the load itself. Caught here, that refusal is reported like every other failure instead of escaping `main`.
    const { resetSeed } = await import("../apps/dashboard/src/modules/dev-runtime/reset");
    summary = await resetSeed();
  } catch (error) {
    reportFailure(error);
    return 1;
  }
  process.stdout.write(parsed.json ? formatJson(summary) : formatSummary(summary));
  const violation = findViolation(summary);
  if (violation !== undefined) {
    reportError(`reset did not restore the deterministic seed: ${violation}`);
    return 1;
  }
  return 0;
}
process.exitCode = await main();
