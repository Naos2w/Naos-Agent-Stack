import { McpServer } from "@modelcontextprotocol/server";
import { buildMcpInstructions, MCP_CONFIG } from "../config.js";
import { isApplyPatchSupported, registerApplyPatchTool } from "../tools/apply-patch/apply-patch.js";
import { registerCapabilityTools } from "../tools/capabilities/capability-tools.js";
import { registerCatalogTools } from "../tools/catalog/catalog-tools.js";
import { LazyBuiltinTools } from "../tools/catalog/lazy-builtin-tools.js";
import { registerFileEditTool, registerFileReadTool, registerFileWriteTool, } from "../tools/file/file-tools.js";
import { registerGoalTools } from "../tools/goals/goal-tools.js";
import { registerImageTools } from "../tools/image/image-tools.js";
import { registerJobTools } from "../tools/jobs/job-tools.js";
import { registerMcpServerManagementTools } from "../tools/mcp-server-management/mcp-server-management-tools.js";
import { registerNodeTools } from "../tools/nodes/node-tools.js";
import { registerProjectTools } from "../tools/projects/project-tools.js";
import { registerProviderTools } from "../tools/providers/provider-tools.js";
import { registerRuleTools } from "../tools/rules/rule-tools.js";
import { registerSearchTools } from "../tools/search/search-tools.js";
import { registerBashProcessTool } from "../tools/shell/bash-process-tool.js";
import { registerBashTool } from "../tools/shell/bash-tool.js";
import { registerTerminalTool, } from "../tools/shell/interactive-shell.js";
import { registerSkillTools } from "../tools/skills/skill-tools.js";
import { registerStartHereTool } from "../tools/start-here/start-here.js";
import { registerStoreTools } from "../tools/store/store-tools.js";
import { registerSubagentTools } from "../tools/subagents/subagent-tools.js";
import { registerSummarizeTool } from "../tools/summarize/summarize-tool.js";
import { registerAgentTeamTools } from "../tools/teams/team-tools.js";
import { registerToolboxManagementTools } from "../tools/toolbox-management/toolbox-management-tools.js";
import { registerWebTool } from "../tools/web/web-tool.js";
import { registerWorkflowTools } from "../tools/workflows/workflow-tools.js";
import { ContextBudgetGuard } from "./context-budget.js";
import { ProgressHeartbeatGuard } from "./progress-heartbeat.js";
import { installToolRegistrationBoundary } from "./tool-registration-boundary.js";
/**
 * Bind process-level capability services once and create short-lived MCP servers on demand.
 * Tool-group enablement, required service checks, and capability registration stay
 * on the MCP side of the transport boundary.
 */
export function createMcpServerFactory(services, profileOverrides = {}) {
    const profile = snapshotMcpRuntimeProfile(profileOverrides);
    const contextBudget = services.contextBudget ?? new ContextBudgetGuard();
    const progressHeartbeat = new ProgressHeartbeatGuard();
    return (context = {}) => createMcpServer({
        ...services,
        auditRequest: context.auditRequest,
        agentObserver: context.agentObserver,
        contextBudget,
        progressHeartbeat,
    }, profile);
}
function createMcpServer(options, profile) {
    const server = new McpServer(profile.server, {
        instructions: buildMcpInstructions(),
    });
    installToolRegistrationBoundary(server, {
        projectScope: options.projectScope,
        goalScope: options.goalScope,
        structuredOutput: profile.toolOutput === "structured",
        agentObserver: options.agentObserver,
        auditRequest: options.auditRequest,
        contextBudget: options.contextBudget,
        progressHeartbeat: options.progressHeartbeat,
    });
    let lazyBuiltins;
    if (options.toolboxRegistry) {
        lazyBuiltins = new LazyBuiltinTools();
        registerToolboxRuntime(server, options, options.toolboxRegistry, lazyBuiltins);
    }
    else {
        registerDirectRuntime(server, options, profile);
    }
    if (options.toolboxRegistry && options.externalMcp) {
        registerCatalogTools(server, options.toolboxRegistry, options.externalMcp, lazyBuiltins);
    }
    else {
        options.externalMcp?.registerTools(server);
    }
    return server;
}
function registerToolboxRuntime(server, options, registry, lazyBuiltins) {
    const capabilityRegistry = options.capabilityRegistry;
    const lazyServer = lazyBuiltins.server();
    registerConfiguredBuiltin(server, lazyServer, registry, "system", (target) => {
        registerStartHereTool(target, capabilityRegistry ? () => capabilityRegistry.list() : undefined, options.projectScope, options.goalScope, () => registry.alwaysAppliedRules());
        if (capabilityRegistry)
            registerCapabilityTools(target, capabilityRegistry, options.capabilityHealth);
        if (options.summaryRegistry)
            registerSummarizeTool(target, options.summaryRegistry);
    });
    registerConfiguredBuiltin(server, lazyServer, registry, "shell", (target) => {
        registerBashTool(target, options.bashProcessManager, options.projectScope, options.jobManager);
        if (options.bashProcessManager)
            registerBashProcessTool(target, options.bashProcessManager);
        if (options.interactiveShellManager)
            registerTerminalTool(target, options.interactiveShellManager, options.projectScope);
    });
    registerConfiguredBuiltin(server, lazyServer, registry, "files", (target) => {
        if (isApplyPatchSupported())
            registerApplyPatchTool(target, options.projectScope);
        registerFileReadTool(target, options.projectScope);
        registerFileWriteTool(target, options.projectScope);
        registerFileEditTool(target, options.projectScope);
    });
    registerConfiguredBuiltin(server, lazyServer, registry, "web", (target) => registerWebTool(target, requireCapabilityService(options.webPageOpener, "web")));
    registerConfiguredBuiltin(server, lazyServer, registry, "skills", (target) => registerSkillTools(target, registry));
    registerConfiguredBuiltin(server, lazyServer, registry, "rules", (target) => registerRuleTools(target, registry));
    registerConfiguredBuiltin(server, lazyServer, registry, "media", (target) => registerImageTools(target, options.projectScope));
    registerConfiguredBuiltin(server, lazyServer, registry, "search", (target) => registerSearchTools(target, options.projectScope));
    registerPlatformTools(server, lazyServer, options, registry);
    const subagentRuntime = options.subagentRuntime;
    if (subagentRuntime)
        registerConfiguredBuiltin(server, lazyServer, registry, "subagents", (target) => {
            registerSubagentTools(target, subagentRuntime, options.smartRouter);
        });
    registry.registerCustomTools(server);
}
function registerPlatformTools(server, lazyServer, options, registry) {
    const jobManager = options.jobManager;
    if (jobManager)
        registerConfiguredBuiltin(server, lazyServer, registry, "jobs", (target) => registerJobTools(target, jobManager, options.projectScope));
    const projectRegistry = options.projectRegistry;
    if (projectRegistry)
        registerBuiltinToolbox(server, registry, "projects", () => registerProjectTools(server, projectRegistry, options.projectScope));
    const goalRegistry = options.goalRegistry;
    if (goalRegistry)
        registerBuiltinToolbox(server, registry, "goals", () => registerGoalTools(server, goalRegistry, options.goalScope));
    registerConfiguredBuiltin(server, lazyServer, registry, "toolbox-manager", (target) => registerToolboxManagementTools(target, registry));
    registerConfiguredBuiltin(server, lazyServer, registry, "mcp-manager", (target) => registerMcpServerManagementTools(target, MCP_CONFIG.externalMcp.configFile, options.externalMcp));
    const capabilityStore = options.capabilityStore;
    if (capabilityStore)
        registerConfiguredBuiltin(server, lazyServer, registry, "store", (target) => registerStoreTools(target, capabilityStore, registry));
    const providerHub = options.providerHub;
    if (providerHub)
        registerConfiguredBuiltin(server, lazyServer, registry, "providers", (target) => registerProviderTools(target, providerHub));
    const agentTeams = options.agentTeams;
    if (agentTeams)
        registerConfiguredBuiltin(server, lazyServer, registry, "teams", (target) => registerAgentTeamTools(target, agentTeams));
    const workflows = options.workflows;
    if (workflows)
        registerConfiguredBuiltin(server, lazyServer, registry, "workflows", (target) => registerWorkflowTools(target, workflows));
    const nodes = options.nodes;
    if (nodes)
        registerConfiguredBuiltin(server, lazyServer, registry, "nodes", (target) => registerNodeTools(target, nodes));
}
function registerDirectRuntime(server, options, profile) {
    const capabilityRegistry = options.capabilityRegistry;
    const toolboxRegistry = options.toolboxRegistry;
    registerStartHereTool(server, capabilityRegistry ? () => capabilityRegistry.list() : undefined, options.projectScope, options.goalScope, toolboxRegistry ? () => toolboxRegistry.alwaysAppliedRules() : undefined);
    if (capabilityRegistry)
        registerCapabilityTools(server, capabilityRegistry, options.capabilityHealth);
    if (options.summaryRegistry)
        registerSummarizeTool(server, options.summaryRegistry);
    if (profile.tools.shell) {
        registerBashTool(server, options.bashProcessManager, options.projectScope, options.jobManager);
        if (options.bashProcessManager)
            registerBashProcessTool(server, options.bashProcessManager);
        if (options.interactiveShellManager)
            registerTerminalTool(server, options.interactiveShellManager, options.projectScope);
    }
    if (profile.tools.applyPatch && isApplyPatchSupported())
        registerApplyPatchTool(server, options.projectScope);
    if (profile.tools.fileRead)
        registerFileReadTool(server, options.projectScope);
    if (profile.tools.fileWrite)
        registerFileWriteTool(server, options.projectScope);
    if (profile.tools.fileWrite)
        registerFileEditTool(server, options.projectScope);
    if (profile.tools.web)
        registerWebTool(server, requireCapabilityService(options.webPageOpener, "web"));
    if (profile.tools.skills)
        registerSkillTools(server, options.toolboxRegistry);
    registerRuleTools(server, options.toolboxRegistry);
    if (profile.tools.image)
        registerImageTools(server, options.projectScope);
    registerDirectPlatformTools(server, options);
}
function registerDirectPlatformTools(server, options) {
    if (options.jobManager)
        registerJobTools(server, options.jobManager, options.projectScope);
    if (options.projectRegistry)
        registerProjectTools(server, options.projectRegistry, options.projectScope);
    if (options.goalRegistry)
        registerGoalTools(server, options.goalRegistry, options.goalScope);
    if (options.capabilityStore)
        registerStoreTools(server, options.capabilityStore, options.toolboxRegistry);
    if (options.providerHub)
        registerProviderTools(server, options.providerHub);
    if (options.subagentRuntime)
        registerSubagentTools(server, options.subagentRuntime, options.smartRouter);
    if (options.agentTeams)
        registerAgentTeamTools(server, options.agentTeams);
    if (options.workflows)
        registerWorkflowTools(server, options.workflows);
    if (options.nodes)
        registerNodeTools(server, options.nodes);
}
function registerConfiguredBuiltin(server, lazyServer, registry, toolboxId, register) {
    const target = registry.isToolboxDynamic(toolboxId) ? lazyServer : server;
    registerBuiltinToolbox(target, registry, toolboxId, () => register(target));
}
function registerBuiltinToolbox(server, registry, toolboxId, register) {
    if (!registry.isToolboxEnabled(toolboxId))
        return;
    const original = server.registerTool;
    const filtered = (name, config, callback) => {
        if (!registry.isToolEnabled(toolboxId, name))
            return;
        const meta = isRecord(config._meta) ? config._meta : {};
        return Reflect.apply(original, server, [
            name,
            { ...config, _meta: { ...meta, "openchatx/toolbox": toolboxId } },
            callback,
        ]);
    };
    Reflect.set(server, "registerTool", filtered);
    try {
        register();
    }
    finally {
        Reflect.set(server, "registerTool", original);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function snapshotMcpRuntimeProfile(overrides) {
    return Object.freeze({
        server: Object.freeze({ ...MCP_CONFIG.server, ...overrides.server }),
        tools: Object.freeze({ ...MCP_CONFIG.tools, ...overrides.tools }),
        toolOutput: overrides.toolOutput ?? MCP_CONFIG.mcp.toolOutput,
    });
}
function requireCapabilityService(service, capability) {
    if (service === undefined)
        throw new Error(`${capability} tools are enabled but their runtime service was not created.`);
    return service;
}
