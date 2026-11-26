/** Counts newline bytes in tracked files, excluding bun.lock, and exits by the 100,000-line limit. */
import { readFile } from "node:fs/promises";
import path from "node:path";
const LIMIT = 100000;
const USAGE = "usage: bun scripts/count-lines.ts\n";
const ROOT = path.join(import.meta.dir, "..");
function countNewlines(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) if (bytes[index] === 10) count += 1;
  return count;
}
async function listTrackedFiles(): Promise<readonly string[]> {
  const run = Bun.spawn(["git", "ls-files", "-z"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [rawList, stderr, exitStatus] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  if (exitStatus !== 0) throw new Error(`git ls-files exited with status ${String(exitStatus)}: ${stderr.trim()}`);
  return rawList.split("\0").filter((entry) => entry !== "" && entry !== "bun.lock");
}
async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 0) {
    process.stderr.write(`count-lines takes no arguments, and received: ${arguments_.join(" ")}\n`);
    process.stderr.write(USAGE);
    return 2;
  }
  let tracked: number;
  let total = 0;
  try {
    const files = await listTrackedFiles();
    tracked = files.length;
    if (tracked === 0) throw new Error(`no tracked files in ${ROOT}`);
    const lines: string[] = [];
    for (const file of files) {
      const count = countNewlines(await readFile(path.join(ROOT, file)));
      total += count;
      lines.push(`${String(count).padStart(7, " ")} ${file}`);
    }
    process.stdout.write(`${lines.join("\n")}\n${String(total).padStart(7, " ")} total\n`);
  } catch (error) {
    process.stderr.write(`failed to count tracked lines: ${String(error)}\n`);
    return 2;
  }
  process.stdout.write(`\ntracked files counted: ${String(tracked)}\nTOTAL ${String(total)}\nLIMIT ${String(LIMIT)}\nSTATUS ${total < LIMIT ? "PASS" : "FAIL"}\n`);
  if (total < LIMIT) return 0;
  process.stdout.write(`OVERAGE ${String(total - LIMIT)}\n`);
  return 1;
}
process.exitCode = await main();
