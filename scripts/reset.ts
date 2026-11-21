/**
 * `bun run reset`: discards every stored session and re-seeds every seeded session from the
 * deterministic seed, so the application starts from the known world every criterion begins at.
 *
 * Implements AAP 0.9.1 (`bun run reset`), 0.9.2's root script line, 0.7.2's reset path, 0.11.1's
 * `scripts/reset.ts` deliverable and 0.12.1 criterion 21's `bun run reset`.
 *
 * Exit contract: 0 only when every session was laid down; 2 for a usage error, because this command
 * takes no arguments, after printing the usage to stderr; and 1 for any failure, with the caught
 * error's message on stderr. A partial reset is reported as a failure, never as a success.
 */
import { resetSeed } from "../apps/dashboard/src/modules/dev-runtime/reset";

/** The one way to run this command, printed on stderr whenever the arguments are refused. */
const USAGE = "usage: bun scripts/reset.ts\n";

/** Reports one line on stderr, so a failure is never written to the stream a success uses. */
function reportError(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    reportError(`reset takes no arguments, and received: ${argv.join(" ")}`);
    process.stderr.write(USAGE);
    return 2;
  }

  try {
    const report = await resetSeed();
    process.stdout.write(
      `store: ${report.storePath}\n` +
        `removed sessions: ${String(report.removedSessionIds.length)}\n` +
        `seeded sessions: ${String(report.seededSessionIds.length)}\n` +
        `session ids: ${report.seededSessionIds.join(", ")}\n`,
    );
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main();
