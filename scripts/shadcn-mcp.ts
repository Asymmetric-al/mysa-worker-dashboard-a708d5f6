/** Project MCP launcher for shadcn: runs from `apps/dashboard` so `components.json` registries resolve, loading any missing placeholder variables from the private machine credential store without modifying the repository. */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD_DIR = path.join(REPO_ROOT, "apps", "dashboard");
const SHADCN_ENTRY = path.join(DASHBOARD_DIR, "node_modules", "shadcn", "dist", "index.js");
const CREDENTIALS_STORE = path.join(homedir(), ".config", "core-agent-tools", "credentials.env");
const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)='([^'\r\n]*)'$/;
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function readPrivateCredentials(): Readonly<Record<string, string>> {
  try {
    const info = lstatSync(CREDENTIALS_STORE);
    if (!info.isFile() || info.isSymbolicLink()) return {};
    const values: Record<string, string> = {};
    for (const rawLine of readFileSync(CREDENTIALS_STORE, "utf8").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const match = ASSIGNMENT.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) values[match[1]] = match[2];
    }
    return values;
  } catch {
    return {};
  }
}

function registryEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...process.env };
  let componentsText = "";
  try {
    componentsText = readFileSync(path.join(DASHBOARD_DIR, "components.json"), "utf8");
  } catch {
    return result;
  }
  const missing: string[] = [];
  for (const match of componentsText.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && (result[name] === undefined || result[name].length === 0)) missing.push(name);
  }
  if (missing.length === 0) return result;
  const store = readPrivateCredentials();
  for (const name of missing) {
    const value = store[name];
    if (value !== undefined && value.length > 0) result[name] = value;
  }
  return result;
}

const command = existsSync(SHADCN_ENTRY) ? "node" : "bun";
const args = existsSync(SHADCN_ENTRY) ? [SHADCN_ENTRY, "mcp"] : ["x", "shadcn@4.23.0", "mcp"];
const child = spawn(command, args, { cwd: DASHBOARD_DIR, env: registryEnvironment(), shell: false, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on("error", (error) => {
  process.stderr.write(`[shadcn-mcp] ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal !== null ? 1 : 0));
});
