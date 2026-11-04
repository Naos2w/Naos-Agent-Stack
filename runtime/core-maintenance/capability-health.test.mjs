import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = new URL('./baseline/health.js', import.meta.url);
const runtimeReadinessSource = new URL('../lean-runtime/runtime_readiness.mjs', import.meta.url);

async function withHealth(callback) {
    const root = await mkdtemp(join(tmpdir(), 'naos-cap-health-'));
    const file = join(root, 'dist', 'capabilities', 'health.js');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'dist', 'config.js'),
        'export const MCP_CONFIG = { tunnel: { healthPort: 8080, profile: "test" }, toolboxes: { get root() { return process.env.OPENCHATX_TEST_TOOLBOX_ROOT || ""; } } };');
    await writeFile(file, await readFile(source));
    const previousFetch = globalThis.fetch;
    const previousRoot = process.env.OPENCHATX_TOOLBOX_ROOT;
    const previousConfiguredRoot = process.env.OPENCHATX_TEST_TOOLBOX_ROOT;
    globalThis.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({ live: true, components: { 'control-plane': { status: 'ok' } } }),
    });
    try {
        const { CapabilityHealthService } = await import(pathToFileURL(file).href);
        await callback({ root, CapabilityHealthService });
    } finally {
        globalThis.fetch = previousFetch;
        if (previousRoot === undefined) delete process.env.OPENCHATX_TOOLBOX_ROOT;
        else process.env.OPENCHATX_TOOLBOX_ROOT = previousRoot;
        if (previousConfiguredRoot === undefined) delete process.env.OPENCHATX_TEST_TOOLBOX_ROOT;
        else process.env.OPENCHATX_TEST_TOOLBOX_ROOT = previousConfiguredRoot;
        await rm(root, { recursive: true, force: true });
    }
}

test('healthy capabilities never mask a degraded Agent Runtime Operation', async () => {
    await withHealth(async ({ CapabilityHealthService }) => {
        const health = new CapabilityHealthService(null, null, null,
            async () => ({ id: 'agent-runtime-readiness', kind: 'runtime',
                name: 'Agent Runtime Readiness', status: 'degraded',
                detail: 'OPERATIONS_REQUIRE_RECONCILIATION; running=0 stale=0 unresolved=1' }));
        const snapshot = await health.snapshot();
        assert.equal(snapshot.status, 'degraded');
        assert.equal(snapshot.components.find(x => x.id === 'openchatx').status, 'healthy');
        assert.equal(snapshot.components.find(x => x.id === 'agent-runtime-readiness').status, 'degraded');
    });
});

test('runtime readiness reads the real isolated helper and fails closed', async () => {
    await withHealth(async ({ root, CapabilityHealthService }) => {
        const toolboxRoot = join(root, 'toolboxes');
        const agent = join(toolboxRoot, 'agent-runtime');
        const helper = join(agent, 'tools', 'runtime_readiness.mjs');
        await mkdir(dirname(helper), { recursive: true });
        await writeFile(helper, await readFile(runtimeReadinessSource));
        process.env.OPENCHATX_TEST_TOOLBOX_ROOT = toolboxRoot;
        delete process.env.OPENCHATX_TOOLBOX_ROOT;
        const health = new CapabilityHealthService(null, null, null);
        await writeFile(join(agent, 'operations.json'), JSON.stringify({
            original: { state: 'failed', reconciliation: { requiresReconciliation: true } },
        }));
        const degraded = await health.snapshot();
        assert.equal(degraded.status, 'degraded');
        assert.match(degraded.components.find(x => x.id === 'agent-runtime-readiness').detail,
            /OPERATIONS_REQUIRE_RECONCILIATION; running=0 stale=0 unresolved=1/);
        await writeFile(join(agent, 'operations.json'), JSON.stringify({
            completed: { state: 'completed', reconciliation: { requiresReconciliation: false } },
        }));
        const recovered = await health.snapshot();
        assert.equal(recovered.status, 'healthy');
        assert.match(recovered.components.find(x => x.id === 'agent-runtime-readiness').detail, /READY;/);
        await rm(helper);
        const unavailable = await health.snapshot();
        assert.equal(unavailable.status, 'degraded');
        assert.equal(unavailable.components.find(x => x.id === 'agent-runtime-readiness').detail,
            'RUNTIME_READINESS_UNVERIFIED');
    });
});

test('unavailable or degraded capability components also affect top-level status', async () => {
    await withHealth(async ({ CapabilityHealthService }) => {
        const health = new CapabilityHealthService(
            { capabilities: () => [{ id: 'external', name: 'External', available: false, toolCount: 0 }] },
            { snapshots: () => [{ id: 'tools', name: 'Tools', enabled: true,
                tools: [{ error: new Error('fixture') }], skills: [] }] },
            null, async () => null);
        const snapshot = await health.snapshot();
        assert.equal(snapshot.status, 'degraded');
        assert.equal(snapshot.components.find(x => x.id === 'mcp:external').status, 'unavailable');
        assert.equal(snapshot.components.find(x => x.id === 'toolbox:tools').status, 'degraded');
    });
});
