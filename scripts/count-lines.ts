/** Measures the repository's tracked line count with the request's own pipeline — `git ls-files`, with `bun.lock` as its only exclusion, piped through `xargs wc -l` — and exits by the 100,000-line limit. */
import path from "node:path";
const MEASURE_COMMAND = "git ls-files | grep -v -e '^bun.lock$' | xargs wc -l";
const LIMIT = 100000;
const ROOT = path.join(import.meta.dir, "..");
interface WcReport {
  tracked: number;
  totals: number[];
}
function readWcReport(stdout: string): WcReport {
  const report: WcReport = { tracked: 0, totals: [] };
  for (const line of stdout.split("\n")) {
    const total = /^\s*(\d+)\s+total$/.exec(line);
    const value = total === null ? null : Number(total[1]);
    if (value !== null && Number.isSafeInteger(value)) report.totals.push(value);
    else if (value === null && /^\s*\d+\s+\S/.test(line)) report.tracked += 1;
  }
  return report;
}
async function main(): Promise<number> {
  let stdout: string;
  let stderr: string;
  let exitStatus: number;
  try {
    const run = Bun.spawn(["/bin/sh", "-c", MEASURE_COMMAND], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    [stdout, stderr, exitStatus] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  } catch (error) {
    process.stderr.write(`failed to run the pipeline: ${String(error)}\n`); // A pipeline that cannot be started is a measurement failure (2), never the over-limit verdict (1).
    return 2;
  }
  process.stdout.write(stdout);
  if (exitStatus !== 0) {
    process.stderr.write(stderr);
    process.stdout.write(`\ncommand failed with exit status ${String(exitStatus)}; nothing was measured\n`);
    return 2;
  }
  const { tracked, totals } = readWcReport(stdout);
  // An empty tracked tree and a directory that is not a git work tree both reach here: git fails on stderr while the pipeline still exits 0 and prints a bare count, so neither may be read as a pass.
  if (tracked === 0 && totals.length === 0) {
    process.stderr.write(stderr);
    process.stdout.write(`\nno tracked files were measured in ${ROOT}: the tracked tree is empty or this is not a git work tree\n`);
    return 2;
  }
  if (totals.length === 0) {
    process.stderr.write(stderr);
    process.stdout.write("\nwc printed no total line; refusing to infer a number\n");
    return 2;
  }
  const total = totals.reduce((sum, value) => sum + value, 0);
  const batches = totals.length > 1 ? ` (summed across ${String(totals.length)} wc batches)` : "";
  process.stdout.write(`\ncommand: ${MEASURE_COMMAND}\n` + `tracked files counted: ${String(tracked)}\n` + `TOTAL ${String(total)}${batches}\n` + `LIMIT ${String(LIMIT)}\n` + `STATUS ${total < LIMIT ? "PASS" : "FAIL"}\n`);
  if (total < LIMIT) return 0;
  process.stdout.write(`OVERAGE ${String(total - LIMIT)}\n`);
  return 1;
}
process.exitCode = await main();
