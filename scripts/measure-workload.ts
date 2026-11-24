/** `bun run measure:workload`: one run of the published-workload measurement. The two performance numbers are observations of this host, taken by `apps/dashboard/e2e/workload-timing.spec.ts` rather than by the ordinary test gate, so the measurement has its own command instead of a variable a reader has to know about. The command prints the load average the run starts and ends at — the figure a reader needs to judge the numbers it produces — runs the spec in the application package on this checkout's own port, and exits with the status the spec's assertions produced, so a missed budget fails the command visibly rather than being printed and forgotten. */
import { loadavg } from "node:os";
import { join } from "node:path";
/** The application package the runner lives in, which is where the spec and the dev server are addressed from. */
const APP_DIRECTORY = join(import.meta.dir, "..", "apps", "dashboard");
/** The one spec that times anything. */
const SPEC = "e2e/workload-timing.spec.ts";
/** The command this script runs, quoted in its own output so a run is reproducible from what it printed. */
const COMMAND = `bunx playwright test ${SPEC}`;
/** The variable the spec reads, set here so the measurement is invoked rather than left to whoever remembers it. */
const MEASUREMENT_VARIABLE = "WORKLOAD_MEASUREMENT";
/** The status a failure to start the measurement exits with: distinct from any status the measurement itself returns. */
const SPAWN_FAILURE = 2;
const loadAverageLine = (label: string): string =>
  `${label}: ${loadavg()
    .map((value) => value.toFixed(2))
    .join(" / ")}\n`;
/** Starts the measurement as its own process, which inherits this process's stdio so every sample the spec logs appears in this command's output. */
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
  process.stdout.write(`port: ${process.env.PORT ?? "3000, the runner's default because PORT is unset"}\n`);
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
