function once(text,before,after) {
  if(text.split(before).length!==2) throw Error('INFLIGHT_RECOVERY_SOURCE_CHANGED');
  return text.replace(before,after);
}

export function patchInflightRecovery(text) {
  if(text.includes('external_execution_schema: 1')) return text;
  text=once(text,'  calls: Array<Record<string, unknown>>,\n) {\n  return client.onMessage',
    '  calls: Array<Record<string, unknown>>,\n) {\n  let executionSequence = 0\n  return client.onMessage');
  text=once(text,'    const toolStartMs = Date.now()',`    const executionSequenceId = ++executionSequence
    // Local sequence and fixed enums only: never log tool inputs or result text.
    process.stderr.write(JSON.stringify({kind: "EXTERNAL_TOOL_EXECUTION", phase: "started",
      sequence: executionSequenceId, sideEffecting: isSideEffectingExternalTool(toolName)}) + "\\n")
    const toolStartMs = Date.now()`);
  text=once(text,'    calls.push({\n      toolCallId:',`    const toolResult = describeToolResult(toolName, result)
    // Written after the idempotency guard has saved the result, before transport.
    process.stderr.write(JSON.stringify({kind: "EXTERNAL_TOOL_EXECUTION", phase: "completed",
      sequence: executionSequenceId, idempotencyStatus, outcome: toolResult.status}) + "\\n")
    calls.push({
      toolCallId:`);
  text=once(text,'      toolResult: describeToolResult(toolName, result),','      toolResult,');
  text=once(text,`    client.send({
      type: "external_tool_call_response",
      request_id: requestId,
      result,
    })`, `    try {
      client.send({
        type: "external_tool_call_response",
        request_id: requestId,
        result,
      })
    } catch {
      // The effect may already be committed. Preserve evidence, never resend.
      process.stderr.write(JSON.stringify({kind: "EXTERNAL_TOOL_EXECUTION", phase: "response_delivery_failed",
        sequence: executionSequenceId}) + "\\n")
    }`);
  return once(text,'          external_requests: externalRequests,',
    '          external_execution_schema: 1,\n          external_requests: externalRequests,');
}
