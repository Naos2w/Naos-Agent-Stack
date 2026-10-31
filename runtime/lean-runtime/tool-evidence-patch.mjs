function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error('Tool evidence anchor missing or ambiguous: ' + before.slice(0, 90));
  return text.replace(before, after);
}

export function patchToolEvidenceWorker(text) {
  if (text.includes('const evidence = summarizeToolEvidence(calls)')) return text;
  text = 'import { describeToolResult, observeWriteTarget, describeFileEffect, summarizeToolEvidence } from "./tool_evidence.mjs"\n' + text;
  text = once(text, '    let idempotencyStatus = "not_applicable"\n\n    if (isSideEffectingExternalTool(toolName)) {',
    `    let idempotencyStatus = "not_applicable"
    let fileEffect: Record<string, unknown> | undefined
    const executeObserved = async () => {
      const before = toolName === "openchatx_write_file"
        ? await observeWriteTarget(project, input, decideProjectToolApproval) : null
      const output = await executeExternalTool(client, project, agentId, toolName, input)
      if (toolName === "openchatx_write_file") {
        const after = await observeWriteTarget(project, input, decideProjectToolApproval)
        fileEffect = describeFileEffect(before, after)
      }
      return output
    }

    try {
    if (isSideEffectingExternalTool(toolName)) {`);
  text = once(text, `          execute: () =>
            executeExternalTool(
              client,
              project,
              agentId,
              toolName,
              input,
            ),`, '          execute: executeObserved,');
  text = once(text, `      result = await executeExternalTool(
        client,
        project,
        agentId,
        toolName,
        input,
      )
    }

    calls.push({`, `      result = await executeObserved()
    }
    } catch {
      // A ledger/dispatch exception may follow a side effect. Preserve unknown
      // settlement, return a bounded error, and never execute it again here.
      if (isSideEffectingExternalTool(toolName)) idempotencyStatus = "uncertain"
      result = { is_error: true, content: [{ type: "text", text: "EXTERNAL_TOOL_DISPATCH_FAILED: inspect execution and ledger state before retrying" }] }
    }

    calls.push({`);
  text = once(text, '      durationMs: Date.now() - toolStartMs,',
    '      durationMs: Date.now() - toolStartMs,\n      toolResult: describeToolResult(toolName, result),\n      fileEffect,');
  const start = text.indexOf('  const changedFiles = [', text.indexOf('function summarizeRunTrace('));
  const end = text.indexOf('  const denied = approvals', start);
  if (start < 0 || end < 0) throw Error('Tool evidence change summary anchor missing');
  text = text.slice(0, start) + '  const evidence = summarizeToolEvidence(calls)\n  const changedFiles = evidence.changedFiles\n\n' + text.slice(end);
  text = once(text, '      external_tool_call_count: calls.length,',
    '      external_tool_call_count: calls.length,\n      tool_outcomes: evidence.toolOutcomes,\n      file_effects: evidence.fileEffects,');
  text = once(text, '    blockers: denied.map(', '    blockers: [...evidence.blockers, ...denied.map(');
  text = once(text, '        `${item.tool}: ${item.reason}`,\n    ),', '        `${item.tool}: ${item.reason}`,\n    )],');
  return text;
}

export function patchEvidenceGuidance(text) {
  if (text.includes('## Tool outcomes and task continuity — version 1')) return text;
  return text.trimEnd()+`\n\n## Tool outcomes and task continuity — version 1

- Operation completion is separate from tool success. Inspect validation.tool_outcomes, file_effects and blockers. A later identical successful request is only observed tool recovery, never permission for an automatic retry or product acceptance.
- changed_files includes only successful direct writes whose bounded before/after observations prove a byte change. Replays, unchanged writes and unverified effects are excluded. Shell and external-editor changes are not covered; inspect the actual diff for delivery.
- For multi-step work, keep the current goal, approved constraints, completed changes, actual test evidence, unresolved issues and next action in the existing project TODO when writing it is authorized. Do not create a second task database or automatic receipt. Read-only work reports this information without writing a checkpoint.
- After compaction or interruption, reread the existing task record and relevant current source before continuing. Use task_ref as an identifier, not a file permission; pass known task/source files in context_paths. Summaries and earlier tool successes do not override current files, permissions or release gates.
`;
}
