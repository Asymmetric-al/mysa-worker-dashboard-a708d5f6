/**
 * `bun run reset`: discards every stored session and re-seeds every seeded session from the
 * deterministic seed, so the application starts from the known world every criterion begins at.
 *
 * Implements AAP 0.9.1 (`bun run reset`), 0.9.2's root script line, 0.7.2's reset path, 0.11.1's
 * `scripts/reset.ts` deliverable and 0.12.1 criterion 21.
 */
import { resetSeed, type ResetSummary } from "../apps/dashboard/src/modules/dev-runtime/reset";

/*
 * The reset itself belongs to the development runtime, never to this file: the Settings control and
 * the Playwright project call the same `resetSeed`, so a second implementation here — listing the
 * stored sessions, clearing the store, building the world again — would let the three callers drift
 * apart. This module reads the command line and reports what that one function did.
 */

/** The one way to run this command, printed on stderr whenever the arguments are refused. */
const USAGE = "usage: bun scripts/reset.ts [--json]\n";

/** The column every summary value starts at, so the five lines align without a table dependency. */
const LABEL_WIDTH = 16;

/** A refusal the caller can fix by typing a different command line. */
class UsageError extends Error {}

/** The arguments this command accepts: whether to print the machine-readable line instead of the block. */
interface ParsedArguments {
  readonly json: boolean;
}

/** Writes one line to stderr, so a failure is never reported on the stream a success uses. */
function reportError(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Reports a rejection with its message and its frames.
 *
 * At this command's boundary every thrown fault is unexpected — the reset is meant to succeed — so
 * the stack is the operator's best clue to which document the store refused to write.
 */
function reportFailure(error: unknown): void {
  if (!(error instanceof Error)) {
    reportError(`reset failed with a non-error value: ${String(error)}`);
    return;
  }

  reportError(error.message.length > 0 ? error.message : error.name);

  // A stack repeats the message on its first line, so only the frames beyond it are added.
  const frames = (error.stack ?? "").split("\n").slice(1).join("\n").trimEnd();
  if (frames.length > 0) process.stderr.write(`${frames}\n`);
}

/** Reads the command line: an optional `--json` and nothing else. */
function parseArguments(argv: readonly string[]): ParsedArguments {
  let json = false;
  const refused: string[] = [];

  for (const argument of argv) {
    if (argument === "--json") json = true;
    else refused.push(argument);
  }

  if (refused.length > 0) {
    throw new UsageError(
      `reset takes no arguments other than --json, and received: ${refused.join(" ")}`,
    );
  }

  return { json };
}

/** One aligned summary line: the label padded to the value column, then the value. */
function summaryLine(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}: ${value}\n`;
}

/**
 * A count with its ids on the same line, ids sorted so two runs of one seed print identical bytes.
 * An empty set prints its count alone, because an empty id list is evidence in itself.
 */
function countAndIds(ids: readonly string[]): string {
  const sortedIds = [...ids].sort();
  return sortedIds.length === 0 ? "0" : `${String(sortedIds.length)}  ${sortedIds.join(", ")}`;
}

/** The human-readable block, in the order the reset is read: what was seeded, what went, then the anchor. */
function formatSummary(summary: ResetSummary): string {
  return (
    "Development data reset — deterministic seed restored\n" +
    summaryLine("seeded sessions", countAndIds(summary.seededSessions)) +
    summaryLine("removed sessions", countAndIds(summary.removedSessions)) +
    summaryLine("partners", String(summary.partners)) +
    summaryLine("seed instant", summary.seedInstant) +
    summaryLine("clock offset", `${String(summary.clockOffsetMs)} ms (must be 0)`)
  );
}

/** The same values as one line, in the field order `ResetSummary` declares, for machine-readable evidence. */
function formatJson(summary: ResetSummary): string {
  return `${JSON.stringify({
    seededSessions: [...summary.seededSessions].sort(),
    removedSessions: [...summary.removedSessions].sort(),
    partners: summary.partners,
    seedInstant: summary.seedInstant,
    clockOffsetMs: summary.clockOffsetMs,
  })}\n`;
}

/**
 * What separates a restored world from a command that merely exited: the clock is back at the seed
 * instant, something was seeded, and the seeded sessions hold partners. A violated check returns the
 * offending value, because "reset succeeded" with zero sessions is the one outcome that must never
 * print as success.
 */
function findViolation(summary: ResetSummary): string | undefined {
  if (summary.clockOffsetMs !== 0) {
    return `clock offset is ${String(summary.clockOffsetMs)} ms, and a reset leaves it at 0`;
  }
  if (summary.seededSessions.length === 0) {
    return "seeded sessions is 0, so the seed laid down nothing";
  }
  if (!(summary.partners > 0)) {
    return `partners is ${String(summary.partners)}, so the seeded sessions hold no partner records`;
  }
  return undefined;
}

/**
 * Runs the one reset and reports it.
 *
 * Exit contract: 0 only when the sessions were laid down and every check held; 2 for a usage error,
 * after printing the usage to stderr; and 1 for any failure or violated check, with its diagnostics
 * on stderr. A partial or empty reset is reported as a failure, never as a success.
 */
async function main(): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      reportError(error.message);
      process.stderr.write(USAGE);
      return 2;
    }
    reportFailure(error);
    return 1;
  }

  let summary: ResetSummary;
  try {
    summary = await resetSeed();
  } catch (error) {
    reportFailure(error);
    return 1;
  }

  // Printed before the checks run, so a violated check is read beside the values it judged.
  process.stdout.write(parsed.json ? formatJson(summary) : formatSummary(summary));

  const violation = findViolation(summary);
  if (violation !== undefined) {
    reportError(`reset did not restore the deterministic seed: ${violation}`);
    return 1;
  }

  return 0;
}

process.exitCode = await main();
