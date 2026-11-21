/**
 * `bun run seed:workload`: generates the deterministic 10,000-partner / 100,000-gift workload into a
 * seeded session's store document, and prints what it wrote.
 *
 * Every part of the generation belongs to `modules/dev-runtime/generate.ts`, which owns the fixed
 * seed, the integer sequence, the deliberate boundary cases, the volume assertions and the store
 * write; this file is that module's command-line surface and holds no generation logic of its own.
 *
 * Implements AAP 0.9.1 (its `scripts/generate-workload.ts` row and `bun run seed:workload`), 0.9.2's
 * root script line, 0.7.2's generator paragraph, 0.11.1's deliverable row, 0.12.3's filtered-Gifts and
 * export measurements and 0.12.4's generated-workload input for criteria 1 and 6.
 *
 * Exit contract: 0 only when the document was written and its published volume asserted; 2 for a usage
 * error — any flag, a second session id, or an empty one — after printing the usage to stderr and
 * writing nothing; and 1 for any failure, including a module refusal, with the caught error's message
 * on stderr. A failure path never exits zero, and a refusal is never retried.
 */
import {
  DEFAULT_WORKLOAD_SESSION_ID,
  generateWorkload,
  WORKLOAD_GIFT_COUNT,
  WORKLOAD_PARTNER_COUNT,
  WORKLOAD_SEED,
  type WorkloadSummary,
} from "../apps/dashboard/src/modules/dev-runtime/generate";

/**
 * The published volume, restated here as this command's own expectation: 10,000 partners and 100,000
 * gift rows.
 *
 * The printed counts are the evidence the plan's measurements quote, so the CLI states the volume it
 * expects rather than echoing whatever the generator happened to write. Both are annotated `number`
 * instead of being left as literal types, because a comparison between two literal `10000`s is folded
 * away by the compiler and the point of the assertion is to catch a drift in the generator at run time.
 */
const EXPECTED_PARTNER_COUNT: number = 10_000;
const EXPECTED_GIFT_COUNT: number = 100_000;

/** The one way to run this command, printed on stderr whenever the arguments are refused. */
const USAGE =
  "usage: bun scripts/generate-workload.ts [session-id]\n" +
  `with no session id the workload is written into ${DEFAULT_WORKLOAD_SESSION_ID}, the seeded session the journeys and the measurements start from.\n`;

/** A refusal the caller can fix by typing a different command line. */
class UsageError extends Error {}

/**
 * Reads the command line: at most one positional session id, and no flags.
 *
 * There is deliberately no `--count`, `--gifts`, `--partners`, `--seed` or `--currency`. The published
 * volume and the seed are fixed values, so an option able to change either would let one run shrink the
 * dataset that every measurement quoting this workload is taken against. The id is passed on exactly
 * as typed, because validating it belongs to the module: it decides which sessions may hold a workload.
 *
 * @throws UsageError when a flag, a second id or an empty id is given.
 */
function parseArguments(argv: readonly string[]): string | undefined {
  let sessionId: string | undefined;

  for (const argument of argv) {
    if (argument.startsWith("-")) {
      throw new UsageError(
        `'${argument}' is not an option of this command: the workload's volume and seed are fixed`,
      );
    }
    if (argument.length === 0) {
      throw new UsageError("a session id cannot be empty");
    }
    if (sessionId !== undefined) {
      throw new UsageError(`only one session id may be given, and '${argument}' is a second`);
    }
    sessionId = argument;
  }

  return sessionId;
}

/** Writes one line to stderr, so a failure is never reported on the stream a success uses. */
function reportError(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Fails loudly unless the run wrote the published volume.
 *
 * A drifted constant is a defect in the generator that would quietly weaken the whole-query agreement
 * of criterion 1 and invalidate the p95 and export-duration measurements, so it fails this command
 * instead of being printed as a smaller dataset.
 *
 * @throws Error when a fixed constant, or the document the run wrote, departs from 10,000 partners and
 * 100,000 gift rows.
 */
function assertPublishedVolume(summary: WorkloadSummary): void {
  const published = `${String(EXPECTED_PARTNER_COUNT)} partners and ${String(EXPECTED_GIFT_COUNT)} gift rows`;

  if (
    WORKLOAD_PARTNER_COUNT !== EXPECTED_PARTNER_COUNT ||
    WORKLOAD_GIFT_COUNT !== EXPECTED_GIFT_COUNT
  ) {
    throw new Error(
      `the generator fixes the workload at ${String(WORKLOAD_PARTNER_COUNT)} partners and ${String(WORKLOAD_GIFT_COUNT)} gift rows, where the published workload is ${published}`,
    );
  }
  if (summary.partners !== EXPECTED_PARTNER_COUNT || summary.gifts !== EXPECTED_GIFT_COUNT) {
    throw new Error(
      `this run wrote ${String(summary.partners)} partners and ${String(summary.gifts)} gift rows, where the published workload is ${published}`,
    );
  }
}

/** One `label : value` line of the report, with every label ending in the same column. */
function reportLine(label: string, value: string): string {
  return `${label.padEnd(16)}: ${value}\n`;
}

/**
 * The report this command prints: the volume, the currency codes and the coverage window, and nothing
 * about the records themselves — no name, address, note body or gift amount, so the console output of a
 * workload run never becomes a second, unlabelled copy of the data.
 *
 * The elapsed figure is the summary's own field, which the module sets from the duration its caller
 * measured and leaves at `0` when the caller measured nothing. This command reads no clock: a
 * wall-clock read here would sit beside the one property the dataset exists for, that two runs produce
 * the same bytes, so it states that nothing was measured rather than inventing a duration.
 */
function formatSummary(summary: WorkloadSummary): string {
  const currencies = [...summary.currencies].sort();
  const elapsed =
    summary.elapsedMs > 0
      ? `${String(summary.elapsedMs)} ms`
      : "0 ms (not measured; this command reads no clock)";

  return (
    "Development data workload generated — synthetic; not a production capacity claim\n" +
    reportLine("seed", String(WORKLOAD_SEED)) +
    reportLine("session", summary.sessionId) +
    reportLine("document", summary.workloadPath) +
    reportLine(
      "partners",
      `${String(summary.partners)} (expected ${String(EXPECTED_PARTNER_COUNT)})`,
    ) +
    reportLine("gifts", `${String(summary.gifts)} (expected ${String(EXPECTED_GIFT_COUNT)})`) +
    reportLine("currencies", currencies.join(", ")) +
    reportLine(
      "coverage",
      `${summary.coverage.from} .. ${summary.coverage.to} (${summary.coverage.state})`,
    ) +
    reportLine("elapsed", elapsed)
  );
}

async function main(): Promise<number> {
  let sessionId: string | undefined;
  try {
    sessionId = parseArguments(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      reportError(error.message);
      process.stderr.write(USAGE);
      return 2;
    }
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    // The bare command is the documented one and takes the module's own default session, so a caller
    // that named no session passes no argument rather than a repeated literal.
    const summary =
      sessionId === undefined ? await generateWorkload() : await generateWorkload(sessionId);
    assertPublishedVolume(summary);
    process.stdout.write(formatSummary(summary));
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main();
