import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const expectedFiles = new Map([
  ["dist/mcp/conversation-bootstrap.js", "conversation-bootstrap.js"],
  ["dist/mcp/server-factory.js", "server-factory.js"],
  ["dist/mcp/tool-registration-boundary.js", "tool-registration-boundary.js"],
  ["dist/tools/start-here/start-here.js", "start-here.js"],
  ["dist/capabilities/health.js", "health.js"],
  ["dist/config.js", "config.js"],
  ["dist/projects/project-executor.js", "project-executor.js"],
  ["dist/server/audit/audit-log.js", "audit-log.js"],
  ["dist/server/audit/audit-format.js", "audit-format.js"],
  ["dist/server/audit/audit-request.js", "audit-request.js"],
  ["dist/server/audit/audit-response.js", "audit-response.js"],
  ["dist/server/http-server.js", "http-server.js"],
  ["dist/mcp/tool-schema-presentation.js", "tool-schema-presentation.js"],
  ["dist/summaries/summary-registry.js", "summary-registry.js"],
  ["dist/tools/summarize/summarize-tool.js", "summarize-tool.js"],
]);
const defaultRuntime = join(
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
  "Programs", "OpenChatX", "runtime",
);
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex").toUpperCase();

async function hashFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("NOT_A_REGULAR_FILE");
  return sha256(await readFile(path));
}

export async function verifyCore({
  runtimeRoot = defaultRuntime,
  manifestPath = join(here, "manifest.json"),
  snapshotRoot = join(here, "baseline"),
} = {}) {
  const failures = [];
  try {
    await lstat(join(dirname(manifestPath), ".audit-update-pending.json"));
    throw new Error("CORE_AUDIT_RECOVERY_REQUIRED");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.runtimePackage !== "openchatx-mcp" ||
      !Array.isArray(manifest.files) || manifest.files.length !== expectedFiles.size) {
    throw new Error("CORE_PATCH_MANIFEST_INVALID");
  }

  const pkg = JSON.parse(await readFile(join(runtimeRoot, "package.json"), "utf8"));
  if (pkg.name !== manifest.runtimePackage || pkg.version !== manifest.runtimeVersion) {
    failures.push(`VERSION expected=${manifest.runtimePackage}@${manifest.runtimeVersion} actual=${pkg.name}@${pkg.version}`);
  }

  const seen = new Set();
  for (const entry of manifest.files) {
    const file = entry.relativePath;
    if (!expectedFiles.has(file) || seen.has(file) ||
        entry.snapshot !== `baseline/${expectedFiles.get(file)}` ||
        !/^[A-F0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`CORE_PATCH_MANIFEST_SCOPE_INVALID: ${String(file)}`);
    }
    seen.add(file);
    const destinations = [
      ["INSTALLED", join(runtimeRoot, ...file.split("/"))],
      ["SNAPSHOT", join(snapshotRoot, expectedFiles.get(file))],
    ];
    for (const [kind, path] of destinations) {
      try {
        const actual = await hashFile(path);
        if (actual !== entry.sha256) {
          failures.push(`${kind} ${file} expected=${entry.sha256} actual=${actual}`);
        }
      } catch (error) {
        failures.push(`${kind} ${file} unreadable=${error.code || error.message}`);
      }
    }
  }
  if (seen.size !== expectedFiles.size) throw new Error("CORE_PATCH_MANIFEST_FILE_SET_INCOMPLETE");
  return { ok: failures.length === 0, version: pkg.version, files: seen.size, failures };
}

function cliOptions(argv) {
  const args = {};
  const keys = new Map([
    ["--runtime-root", "runtimeRoot"],
    ["--manifest", "manifestPath"],
    ["--snapshot-root", "snapshotRoot"],
  ]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys.get(argv[i]);
    if (!key || typeof argv[i + 1] !== "string") {
      throw new Error("CORE_PATCH_CHECK_ARGS_INVALID");
    }
    args[key] = argv[i + 1];
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].toLowerCase()) {
  try {
    const status = await verifyCore(cliOptions(process.argv.slice(2)));
    if (status.ok) {
      process.stdout.write(`CORE_PATCH_VERIFIED version=${status.version} files=${status.files}\n`);
    } else {
      for (const failure of status.failures) {
        process.stdout.write(`CORE_PATCH_DRIFT ${failure}\n`);
      }
      process.stdout.write("CORE_PATCH_REVIEW_REQUIRED: no automatic restore or runtime restart\n");
      process.exitCode = 7;
    }
  } catch (error) {
    process.stdout.write(`CORE_PATCH_CHECK_FAILED: ${error.message}\n`);
    process.exitCode = 7;
  }
}
