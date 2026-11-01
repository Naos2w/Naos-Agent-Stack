import { getAgentIdentity } from "../agent/context.js";
import { MCP_CONFIG } from "../config.js";
import { appendConversationContext } from "./conversation-bootstrap.js";
import { shellRunFileEditNotices } from "../tools/shell/apply-patch-guidance.js";
import { START_HERE_TOOL_NAME } from "../tools/start-here/start-here.js";
import { ToolError, toToolError } from "./tool-error.js";
import { appendToolEvents, compactToolResult, normalizeToolResultImages } from "./tool-output.js";
import { prepareToolRegistration, projectRoutingInputError } from "./tool-schema-presentation.js";
export function installToolRegistrationBoundary(server, options) {
    const originalRegisterTool = server.registerTool;
    const registerTool = (name, config, callback) => Reflect.apply(originalRegisterTool, server, [name, config, callback]);
    const { structuredOutput } = options;
    const dispatchTool = async (name, tool, inputValue, context) => {
        const input = isRecord(inputValue) ? inputValue : {};
        const auditCall = options.auditRequest?.claimTool(context.mcpReq.id, name);
        let observedCallId;
        try {
            const agent = getAgentIdentity();
            if (agent && name !== START_HERE_TOOL_NAME && !agent.taskSlug) {
                throw new ToolError("INITIALIZATION_REQUIRED", "openchatx-mcp has not been initialized for this conversation. Call `start_here` first, and follow the instructions.");
            }
            if (agent?.projectRouting === "pending" && !isProjectRoutingTool(name, input)) {
                throw new ToolError("PROJECT_ROUTING_REQUIRED", "Resolve Project routing before normal work with project_manage. For project work: action=list, action=upsert if needed, then action=use with project_id. For machine/global work: action=use with project_id=null. Do not bypass routing or reach for internal paths. Only glob is available while routing is pending.");
            }
            const routingError = projectRoutingInputError(name, input);
            if (routingError) throw new ToolError("PROJECT_ARGUMENT_REQUIRED", routingError);
            observedCallId = options.agentObserver?.startTool(agent, name, input);
            const userStopController = new AbortController();
            options.agentObserver?.registerToolStop(agent, observedCallId, () => {
                if (userStopController.signal.aborted)
                    return;
                userStopController.abort(new ToolError("USER_FORCED_STOP", "（被用戶強制停止）"));
            });
            const callbackContext = withToolSignal(context, userStopController.signal);
            const result = await (tool.acceptsInput
                ? tool.callback(inputValue, callbackContext)
                : tool.callback(callbackContext));
            const normalizedResult = normalizeToolResultImages(result);
            const projected = !tool.nativeContent && !structuredOutput
                ? compactToolResult(name, normalizedResult)
                : normalizedResult;
            const resultWithEvents = appendProgressHeartbeat(appendToolEvents(projected, collectToolEvents(name, input, agent, options)), options.progressHeartbeat, agent);
            const enriched = await appendConversationContext(resultWithEvents, { name, input, agent, stateDir: MCP_CONFIG.stateDir, toolboxRoot: MCP_CONFIG.toolboxes.root, projectScope: options.projectScope, goalScope: options.goalScope });
            const finalResult = await applyContextBudgetNotice(options.contextBudget, options.agentObserver, agent, name, input, enriched);
            if (isErrorResult(finalResult))
                options.agentObserver?.failTool(agent, observedCallId, finalResult);
            else
                options.agentObserver?.finishTool(agent, observedCallId, isFileEditingTool(name) ? result : finalResult);
            auditCall?.finish({ toolResult: result, modelResult: finalResult });
            return finalResult;
        }
        catch (error) {
            const agent = getAgentIdentity();
            const result = formatToolError(error, structuredOutput);
            const resultWithEvents = appendToolEvents(result, collectToolEvents(name, input, agent, options));
            const resultWithProgress = appendProgressHeartbeat(resultWithEvents, options.progressHeartbeat, agent);
            const finalResult = await applyContextBudgetNotice(options.contextBudget, options.agentObserver, agent, name, input, resultWithProgress);
            options.agentObserver?.failTool(agent, observedCallId, finalResult);
            auditCall?.finish({ error, modelResult: finalResult });
            return finalResult;
        }
    };
    const boundaryRegisterTool = (name, config, callback) => {
        const registration = prepareToolRegistration(name, config, structuredOutput);
        if (typeof callback !== "function")
            return registerTool(name, config, callback);
        const tool = {
            callback: (...args) => callback(...args),
            ...registration,
        };
        const wrapped = tool.acceptsInput
            ? (inputValue, context) => dispatchTool(name, tool, inputValue, context)
            : (context) => dispatchTool(name, tool, undefined, context);
        return registerTool(name, config, wrapped);
    };
    if (!Reflect.set(server, "registerTool", boundaryRegisterTool)) {
        throw new TypeError("Could not install the MCP tool registration boundary.");
    }
}
function withToolSignal(context, localSignal) {
    return {
        ...context,
        mcpReq: {
            ...context.mcpReq,
            signal: AbortSignal.any([context.mcpReq.signal, localSignal]),
        },
    };
}
function appendProgressHeartbeat(result, progressHeartbeat, agent) {
    const instruction = progressHeartbeat?.record(agent);
    return appendToolEvents(result, instruction ? [instruction] : []);
}
async function applyContextBudgetNotice(contextBudget, observer, agent, name, input, result) {
    const notice = await contextBudget?.record(agent, name, input, result);
    observer?.updateContextBudget(agent, contextBudget?.usage(agent));
    return appendToolEvents(result, notice ? [notice] : []);
}
function collectToolEvents(name, input, agent, options) {
    return [
        ...(name === "bash" ? shellRunFileEditNotices(input) : []),
        ...(options.agentObserver?.drainInstructions(agent) ?? []),
    ];
}
function formatToolError(error, structuredOutput) {
    const failure = toToolError(error);
    return {
        isError: true,
        ...(structuredOutput ? { structuredContent: { error_code: failure.code } } : {}),
        content: [{ type: "text", text: `${failure.code}: ${failure.message}` }],
    };
}
function isFileEditingTool(name) {
    return name === "file_edit" || name === "file_write";
}
function isProjectRoutingTool(name, input) {
    if (name === START_HERE_TOOL_NAME ||
        name === "summarize" ||
        name === "tool_search" ||
        name === "glob")
        return true;
    if (name.startsWith("project_"))
        return true;
    return (name === "tool_call" &&
        typeof input.tool === "string" &&
        input.tool.startsWith("builtin:project_"));
}
function isErrorResult(value) {
    const record = isRecord(value) ? value : undefined;
    return record?.isError === true;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
