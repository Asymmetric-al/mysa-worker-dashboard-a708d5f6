/**
 * `bun run seed:workload`: generates the deterministic 10,000-partner / 100,000-gift workload into a
 * seeded session's store document, and prints what it wrote.
 *
 * Implements AAP 0.9.1 (`bun run seed:workload`), 0.9.2's root script line, 0.7.2's generator row,
 * 0.11.1's `scripts/generate-workload.ts` deliverable and 0.12.4's generated-workload input.
 *
 * Exit contract: 0 only when the document was written; 2 for a usage error — an unknown argument, a
 * missing `--session` value, or an id that names no seeded session — after printing the usage to
 * stderr; and 1 for any failure, with the caught error's message on stderr. A failure path never
 * exits zero.
 */
import {
  DEFAULT_WORKLOAD_SESSION_ID,
  generateWorkload,
} from "../apps/dashboard/src/modules/dev-runtime/generate";
import {
  SEEDED_SESSION_IDS,
  isSeededSessionId,
} from "../apps/dashboard/src/modules/dev-runtime/seed";

/** The one way to run this command, printed on stderr whenever the arguments are refused. */
const USAGE =
  "usage: bun scripts/generate-workload.ts [--session <seeded-session-id>]\n" +
  `seeded session ids: ${SEEDED_SESSION_IDS.join(", ")}\n`;

/** A refusal the caller can fix by typing a different command line. */
class UsageError extends Error {}

/** The arguments this command accepts: the session to write the workload into. */
interface ParsedArguments {
  readonly sessionId: string;
}

/**
 * Reads the command line: an optional `--session <id>` and nothing else.
 *
 * The default is the session the journeys and the measurements start from, so the bare command is
 * the documented one and any other session is stated explicitly.
 */
function parseArguments(argv: readonly string[]): ParsedArguments {
  let sessionId = DEFAULT_WORKLOAD_SESSION_ID;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--session") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError("--session needs a seeded session id after it");
      }
      sessionId = value;
      index += 1;
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(argument)}`);
    }
  }

  if (!isSeededSessionId(sessionId)) {
    throw new UsageError(`${JSON.stringify(sessionId)} names no seeded session`);
  }
  return { sessionId };
}

/** Writes one line to stderr, so a failure is never reported on the stream a success uses. */
function reportError(message: string): void {
  process.stderr.write(`${message}\n`);
}

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
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const report = await generateWorkload(parsed.sessionId);
    process.stdout.write(
      `store: ${report.storePath}\n` +
        `session: ${report.sessionId}\n` +
        `document: ${report.workloadPath}\n` +
        `bytes: ${String(report.bytes)}\n` +
        `partners: ${String(report.partnerCount)}\n` +
        `gifts: ${String(report.giftCount)}\n`,
    );
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main();
