/** Project MCP launcher for `shadcn-studio-mcp`: maps `SHADCN_STUDIO_EMAIL` and `SHADCN_STUDIO_LICENSE_KEY` from the environment or private credential store to `EMAIL` and `API_KEY` on a clean child environment. */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CREDENTIALS_STORE = path.join(homedir(), ".config", "core-agent-tools", "credentials.env");
const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)='([^'\r\n]*)'$/;
const ALLOWED_RUNTIME_ENV_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LOCALAPPDATA",
  "NO_PROXY",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "PATH",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "Path",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

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

const fallback = readPrivateCredentials();
const studioEmail = process.env.SHADCN_STUDIO_EMAIL ?? fallback.SHADCN_STUDIO_EMAIL ?? "";
const studioLicenseKey = process.env.SHADCN_STUDIO_LICENSE_KEY ?? fallback.SHADCN_STUDIO_LICENSE_KEY ?? "";
if (studioEmail.length === 0 || studioLicenseKey.length === 0) {
  process.stderr.write("Missing SHADCN_STUDIO_EMAIL or SHADCN_STUDIO_LICENSE_KEY.\n");
  process.exit(1);
}

const childEnv: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && (ALLOWED_RUNTIME_ENV_KEYS.has(key) || key.startsWith("npm_config_"))) childEnv[key] = value;
}
childEnv.EMAIL = studioEmail;
childEnv.API_KEY = studioLicenseKey;

const localAppData = process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
const localStudioEntry = path.join(localAppData, "core-agent-tools", "node", "node_modules", "shadcn-studio-mcp", "build", "index.js");
const command = existsSync(localStudioEntry) ? "node" : "bun";
const args = existsSync(localStudioEntry) ? [localStudioEntry] : ["x", "shadcn-studio-mcp@1.0.7"];
const child = spawn(command, args, { env: childEnv, shell: false, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on("error", (error) => {
  process.stderr.write(`[shadcn-studio-mcp] ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal !== null ? 1 : 0));
});
