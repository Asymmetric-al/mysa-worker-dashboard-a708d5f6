/** `bun run seed:workload`: generates the deterministic 10,000-partner / 100,000-gift workload into a seeded session's store document, and prints what it wrote. */
import { DEFAULT_WORKLOAD_SESSION_ID, generateWorkload, WORKLOAD_GIFT_COUNT, WORKLOAD_PARTNER_COUNT, WORKLOAD_SEED, type WorkloadSummary } from "../apps/dashboard/src/modules/dev-runtime/generate";
const EXPECTED_PARTNER_COUNT: number = 10_000;
const EXPECTED_GIFT_COUNT: number = 100_000;
const USAGE = "usage: bun scripts/generate-workload.ts [session-id]\n" + `with no session id the workload is written into ${DEFAULT_WORKLOAD_SESSION_ID}, the seeded session the journeys and the measurements start from.\n`;
class UsageError extends Error {}
function parseArguments(argv: readonly string[]): string | undefined {
  let sessionId: string | undefined;
  for (const argument of argv) {
    if (argument.startsWith("-")) throw new UsageError(`'${argument}' is not an option of this command: the workload's volume and seed are fixed`);
    if (argument.length === 0) throw new UsageError("a session id cannot be empty");
    if (sessionId !== undefined) throw new UsageError(`only one session id may be given, and '${argument}' is a second`);
    sessionId = argument;
  }
  return sessionId;
}
const reportError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};
function assertPublishedVolume(summary: WorkloadSummary): void {
  const published = `${String(EXPECTED_PARTNER_COUNT)} partners and ${String(EXPECTED_GIFT_COUNT)} gift rows`;
  if (WORKLOAD_PARTNER_COUNT !== EXPECTED_PARTNER_COUNT || WORKLOAD_GIFT_COUNT !== EXPECTED_GIFT_COUNT) throw new Error(`the generator fixes the workload at ${String(WORKLOAD_PARTNER_COUNT)} partners and ${String(WORKLOAD_GIFT_COUNT)} gift rows, where the published workload is ${published}`);
  if (summary.partners !== EXPECTED_PARTNER_COUNT || summary.gifts !== EXPECTED_GIFT_COUNT) throw new Error(`this run wrote ${String(summary.partners)} partners and ${String(summary.gifts)} gift rows, where the published workload is ${published}`);
}
const reportLine = (label: string, value: string): string => `${label.padEnd(16)}: ${value}\n`;
function formatSummary(summary: WorkloadSummary): string {
  const currencies = [...summary.currencies].sort();
  const elapsed = summary.elapsedMs > 0 ? `${String(summary.elapsedMs)} ms` : "0 ms (not measured; this command reads no clock)";
  return (
    "Development data workload generated — synthetic; not a production capacity claim\n" +
    reportLine("seed", String(WORKLOAD_SEED)) +
    reportLine("session", summary.sessionId) +
    reportLine("document", summary.workloadPath) +
    reportLine("partners", `${String(summary.partners)} (expected ${String(EXPECTED_PARTNER_COUNT)})`) +
    reportLine("gifts", `${String(summary.gifts)} (expected ${String(EXPECTED_GIFT_COUNT)})`) +
    reportLine("currencies", currencies.join(", ")) +
    reportLine("coverage", `${summary.coverage.from} .. ${summary.coverage.to} (${summary.coverage.state})`) +
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
    const summary = sessionId === undefined ? await generateWorkload() : await generateWorkload(sessionId); // The bare command is the documented one and takes the module's own default session, so a caller that named no session passes no argument rather than a repeated literal.
    assertPublishedVolume(summary);
    process.stdout.write(formatSummary(summary));
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
process.exitCode = await main();
