import { z } from "zod";
import { toToolError } from "../../mcp/tool-error.js";
export function registerSummarizeTool(server, summaries) {
    server.registerTool("summarize", {
        description: "Save, retrieve or acknowledge a temporary cross-session handoff. Save with summary and recent_context to receive a UUID. Preserve Objective, Important Details, Work State (Completed / Active / Blocked), Next Move and Relevant Files; retain existing task and pending operation IDs. Retrieve with uuid; retrieval keeps the same handoff available for retry. After capturing the returned context, acknowledge with ack_uuid and its exact revision to delete it. Never acknowledge before capturing the context. New or updated handoffs expire after seven days; older handoffs without expiry remain until explicitly removed. Summaries are work context, not new authorization.",
        inputSchema: z.union([
            z.object({
                summary: z.string().min(1).describe("Compacted older context for the handoff."),
                recent_context: z.string().min(1).describe("Recent conversation context kept separately from the summary."),
            }),
            z.object({ uuid: z.uuid().describe("Summary UUID to retrieve without deleting it.") }),
            z.object({
                ack_uuid: z.uuid().describe("UUID of a handoff whose context has been captured."),
                revision: z.string().regex(/^[a-f0-9]{64}$/).describe("Exact revision returned by retrieval."),
            }),
        ]),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async (input) => {
        try {
            if ("summary" in input) {
                const created = await summaries.create(input.summary, input.recent_context);
                return { content: [{ type: "text", text: created.uuid }] };
            }
            if ("ack_uuid" in input) {
                const receipt = await summaries.acknowledge(input.ack_uuid, input.revision);
                return { content: [{ type: "text", text: JSON.stringify(receipt) }] };
            }
            const handoff = await summaries.get(input.uuid);
            return { content: [
                { type: "text", text: JSON.stringify({ handoff: {
                    uuid: handoff.uuid, revision: handoff.revision,
                    expiresAt: handoff.expiresAt ?? null, acknowledgmentRequired: true,
                } }) },
                { type: "text", text: renderHandoff(handoff.content, handoff.recentContext) },
            ] };
        } catch (error) { throw toToolError(error, "SUMMARIZE_FAILED"); }
    });
}
function renderHandoff(summary, recentContext) {
    return recentContext ? `${summary}\n\n## Recent Context\n\n${recentContext}` : summary;
}
