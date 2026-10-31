import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const checker = join(base, "verify-core.mjs");
const source = join(base, "baseline");
const { verifyCore } = await import(pathToFileURL(checker).href);

async function verify(runtime) {
  return verifyCore({ runtimeRoot: runtime });
}

test("known-good core baseline passes, changing any compiled module or version fails without restoring", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "openchatx-core-baseline-"));
  try {
    const projectFile = join(fixture, "dist", "projects", "project-executor.js");
    const auditFile = join(fixture, "dist", "server", "audit", "audit-log.js");
    await mkdir(dirname(projectFile), { recursive: true });
    await mkdir(dirname(auditFile), { recursive: true });
    await copyFile(join(source, "project-executor.js"), projectFile);
    await copyFile(join(source, "audit-log.js"), auditFile);
    const formatFile = join(fixture, "dist", "server", "audit", "audit-format.js");
    await copyFile(join(source, "audit-format.js"), formatFile);
    const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
    for (const entry of manifest.files) {
      const target = join(fixture, entry.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(base, entry.snapshot), target);
    }
    await writeFile(join(fixture, "package.json"),
      JSON.stringify({ name: "openchatx-mcp", version: "1.0.0-beta.2" }), "utf8");

    const good = await verify(fixture);
    assert.equal(good.ok, true, good.failures.join("; "));

    await appendFile(projectFile, "\n// unexpected upgrade\n", "utf8");
    const drift = await verify(fixture);
    assert.equal(drift.ok, false);
    assert.match(drift.failures.join("; "), /INSTALLED dist\/projects\/project-executor\.js/);
    assert.match(await readFile(projectFile, "utf8"), /unexpected upgrade/);

    await copyFile(join(source, "project-executor.js"), projectFile);
    await appendFile(formatFile, "\n// formatter drift\n", "utf8");
    const formatDrift = await verify(fixture);
    assert.equal(formatDrift.ok, false);
    assert.match(formatDrift.failures.join("; "), /INSTALLED dist\/server\/audit\/audit-format\.js/);
    await copyFile(join(source, "audit-format.js"), formatFile);
    await writeFile(join(fixture, "package.json"),
      JSON.stringify({ name: "openchatx-mcp", version: "1.0.0-beta.3" }), "utf8");
    const version = await verify(fixture);
    assert.equal(version.ok, false);
    assert.match(version.failures.join("; "), /VERSION expected=/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
