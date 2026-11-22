/**
 * `bun run measure:workload`: one run of the published-workload measurement.
 *
 * The plan's two performance numbers (AAP 0.12.3) are observations of this host, taken by one run of
 * `apps/dashboard/e2e/workload-timing.spec.ts` and not by the ordinary test gate, so the measurement
 * has its own documented command instead of a variable a reader has to know about. The command prints
 * the load average the run starts at — the figure a reader needs to judge the numbers it produces —
 * runs the spec in the application package with `WORKLOAD_MEASUREMENT=1` on the caller's own port, so
 * it drives the dev server this checkout already has, prints the load average it ends at, and exits
 * with the status the spec's assertions produced, so a missed budget fails the command visibly rather
 * than being printed and forgotten.
 */
import { loadavg } from "node:os";
import { join } from "node:path";

/** The application package the runner lives in, which is where the spec and the dev server are addressed from. */
const APP_DIRECTORY = join(import.meta.dir, "..", "apps", "dashboard");

/** The one spec that times anything. */
const SPEC = "e2e/workload-timing.spec.ts";

/** The variable the spec reads, set here so the measurement is invoked rather than left to whoever remembers it. */
const MEASUREMENT_VARIABLE = "WORKLOAD_MEASUREMENT";

/** The variable the runner takes this checkout's dev-server port from (`apps/dashboard/playwright.config.ts`). */
const PORT_VARIABLE = "PORT";

/** The port the runner falls back to when nothing states one, quoted so a run that measured the wrong server is visible. */
const DEFAULT_PORT = "3000";

/** The command this script runs, quoted in its own output so the run is reproducible from what it printed. */
const COMMAND = `bunx playwright test ${SPEC}`;

/** The status a failure to start the measurement exits with: distinct from any status the measurement itself returns. */
const SPAWN_FAILURE = 2;

/** One load average as the three kernel figures, to the precision a host under load is read at. */
function loadAverageLine(label: string): string {
  return `${label}: ${loadavg()
    .map((value) => value.toFixed(2))
    .join(" / ")}\n`;
}

/**
 * Starts the measurement as its own process with this checkout's port and the variable the spec reads.
 *
 * The child inherits this process's stdio, so the runner's list of cases and every sample the spec logs
 * appear in this command's own output rather than being buffered behind it, and its environment is this
 * one's with the measurement switched on — so the caller's `PORT` reaches the runner unchanged.
 */
function spawnMeasurement(): ReturnType<typeof Bun.spawn> {
  try {
    return Bun.spawn(["bunx", "playwright", "test", SPEC], { cwd: APP_DIRECTORY, env: { ...process.env, [MEASUREMENT_VARIABLE]: "1" }, stdio: ["inherit", "inherit", "inherit"] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`\`${COMMAND}\` could not be spawned in ${APP_DIRECTORY}: ${detail}. The measurement is a Playwright spec, so the application package's own runner has to be installed and this command run from the checkout.`);
  }
}

async function main(): Promise<number> {
  process.stdout.write(`measurement: ${COMMAND} (cwd ${APP_DIRECTORY})\n`);
  process.stdout.write(`port: ${process.env[PORT_VARIABLE] ?? `${DEFAULT_PORT}, the runner's default because ${PORT_VARIABLE} is unset`}\n`);
  process.stdout.write(loadAverageLine("load average at start"));
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = spawnMeasurement();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return SPAWN_FAILURE;
  }
  const exitStatus = await child.exited;
  process.stdout.write(loadAverageLine("load average at end"));
  process.stdout.write(`measurement exit status: ${String(exitStatus)}\n`);
  return exitStatus;
}

process.exitCode = await main();
