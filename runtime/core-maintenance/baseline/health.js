import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MCP_CONFIG } from "../config.js";

const TUNNEL_STARTUP_GRACE_MS = 15_000;

// Capability availability and agent operation readiness are separate signals.
// Both must be observable before reporting overall health as healthy.
export class CapabilityHealthService {
    externalMcp;
    toolboxes;
    subagents;
    startedAt = Date.now();
    readinessInspector;

    constructor(externalMcp, toolboxes, subagents, readinessInspector = inspectAgentRuntime) {
        this.externalMcp = externalMcp;
        this.toolboxes = toolboxes;
        this.subagents = subagents;
        this.readinessInspector = readinessInspector;
    }

    async snapshot() {
        const components = [
            { id: "openchatx", kind: "runtime", name: "OpenChatX Runtime", status: "healthy" },
            await tunnelHealth(Date.now() - this.startedAt < TUNNEL_STARTUP_GRACE_MS),
            ...this.mcpComponents(),
            ...this.toolboxComponents(),
            ...this.providerComponents(),
        ];
        const readiness = await this.readinessInspector();
        if (readiness)
            components.push(readiness);
        return {
            status: components.some(component => ["unavailable", "degraded"].includes(component.status))
                ? "degraded"
                : components.some(component => component.status === "starting")
                    ? "starting"
                    : "healthy",
            checkedAt: new Date().toISOString(),
            components,
        };
    }

    mcpComponents() {
        return (this.externalMcp?.capabilities().map(capability => ({
            id: `mcp:${capability.id}`,
            kind: "mcp",
            name: capability.name,
            status: capability.available ? "healthy" : "unavailable",
            detail: capability.available ? `${capability.toolCount} tools available` : "Configured but unavailable",
        })) ?? []);
    }

    toolboxComponents() {
        return (this.toolboxes?.snapshots().map(toolbox => {
            const errors = [...toolbox.tools, ...toolbox.skills].filter(item => item.error);
            let status = "healthy";
            if (!toolbox.enabled)
                status = "disabled";
            else if (errors.length > 0)
                status = "degraded";
            return {
                id: `toolbox:${toolbox.id}`,
                kind: "toolbox",
                name: toolbox.name,
                status,
                detail: errors.length > 0
                    ? `${errors.length} item${errors.length === 1 ? "" : "s"} failed to load`
                    : `${toolbox.tools.filter(item => item.enabled).length} tools, ${toolbox.skills.filter(item => item.enabled).length} skills`,
            };
        }) ?? []);
    }

    providerComponents() {
        return (this.subagents?.providerSummaries().map(provider => ({
            id: `provider:${provider.id}`,
            kind: "provider",
            name: provider.id,
            status: provider.enabled ? "healthy" : "disabled",
            detail: provider.enabled
                ? `${provider.profileCount} enabled model profile${provider.profileCount === 1 ? "" : "s"}`
                : "Provider disabled",
        })) ?? []);
    }
}

async function inspectAgentRuntime() {
    const toolboxRoot = MCP_CONFIG.toolboxes?.root || process.env.OPENCHATX_TOOLBOX_ROOT;
    if (!toolboxRoot)
        return null; // No configured toolbox root; standalone core without Agent Runtime.
    const common = { id: "agent-runtime-readiness", kind: "runtime", name: "Agent Runtime Readiness" };
    try {
        const root = join(toolboxRoot, "agent-runtime");
        const helperPath = join(root, "tools", "runtime_readiness.mjs");
        const helperStat = await lstat(helperPath);
        if (!helperStat.isFile() || helperStat.isSymbolicLink())
            throw new Error("READINESS_HELPER_UNTRUSTED");
        const moduleUrl = pathToFileURL(helperPath).href;
        const { inspectRuntimeReadiness } = await import(moduleUrl);
        if (typeof inspectRuntimeReadiness !== "function")
            throw new Error("READINESS_EXPORT_MISSING");
        const state = await inspectRuntimeReadiness(root);
        if (typeof state?.ready !== "boolean" || typeof state?.reason !== "string")
            throw new Error("READINESS_INVALID");
        const reason = /^[A-Z0-9_]{1,64}$/.test(state.reason) ? state.reason : "READINESS_UNVERIFIED";
        const counts = ["running", "stale", "unresolved"]
            .map(key => `${key}=${Number.isSafeInteger(state[key]) && state[key] >= 0 ? state[key] : "unknown"}`)
            .join(" ");
        return {
            ...common,
            status: state.ready ? "healthy" : "degraded",
            detail: `${reason}; ${counts}`,
        };
    } catch {
        // A missing/unreadable registry or helper cannot be reported as healthy.
        return { ...common, status: "degraded", detail: "RUNTIME_READINESS_UNVERIFIED" };
    }
}

async function tunnelHealth(starting) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(`http://127.0.0.1:${MCP_CONFIG.tunnel.healthPort}/health?details=true`, { signal: controller.signal });
        const payload = response.ok ? await response.json().catch(() => undefined) : undefined;
        const operational = isTunnelOperational(payload);
        return {
            id: "tunnel",
            kind: "tunnel",
            name: "OpenAI Secure MCP Tunnel",
            status: tunnelHealthStatus(operational, starting),
            ...tunnelHealthDetail(operational, starting, response.status, response.ok, payload),
        };
    } catch (error) {
        return {
            id: "tunnel",
            kind: "tunnel",
            name: "OpenAI Secure MCP Tunnel",
            status: starting ? "starting" : "unavailable",
            ...(starting ? {} : { detail: error instanceof Error ? error.message : "Tunnel health check failed" }),
        };
    } finally {
        clearTimeout(timeout);
    }
}
export function tunnelHealthStatus(operational, starting) {
    if (operational)
        return "healthy";
    if (starting)
        return "starting";
    return "unavailable";
}
function tunnelHealthDetail(operational, starting, status, responseOk, payload) {
    if (operational) {
        const suffix = tunnelMcpObservation(payload) === "unobserved" ? " · MCP probe unobserved" : "";
        return { detail: `profile ${MCP_CONFIG.tunnel.profile} · control plane connected${suffix}` };
    }
    if (starting)
        return {};
    return { detail: responseOk ? "Tunnel control plane is not connected" : `HTTP ${status}` };
}
export function tunnelMcpObservation(value) {
    const health = asRecord(value);
    const components = health ? asRecord(health.components) : undefined;
    const mcp = components ? asRecord(components.mcp) : undefined;
    if (!mcp || mcp.state === "not_observed" || mcp.status === "unknown")
        return "unobserved";
    return "observed";
}
export function isTunnelOperational(value) {
    const health = asRecord(value);
    if (health?.live !== true)
        return false;
    const components = asRecord(health.components);
    const controlPlane = components ? asRecord(components["control-plane"]) : undefined;
    return controlPlane?.status === "ok";
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    return Object.fromEntries(Object.entries(value));
}
