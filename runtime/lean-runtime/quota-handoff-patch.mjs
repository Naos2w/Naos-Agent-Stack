// Inject terminal evidence into the existing Letta Worker without changing tool execution.
export function patchQuotaWorker(source) {
  const marker='kind: "LETTA_TURN_TERMINAL_FAILURE"';
  if (source.includes(marker)) return source;
  const anchor = '    if (typeof finished.error === "string" && finished.error) {\n      throw new Error(\`LETTA_TURN_FAILED: \${finished.error}\`)\n    }';
  if (source.split(anchor).length !== 2) throw Error('Quota handoff Worker anchor missing or ambiguous');
  const replacement = [
    '    if (typeof finished.error === "string" && finished.error) {',
    '      process.stderr.write(JSON.stringify({',
    '        kind: "LETTA_TURN_TERMINAL_FAILURE",',
    '        client_message_id: clientMessageId,',
    '        external_execution_schema: 1,',
    '        external_requests: externalRequests,',
    '        external_completed: externalCalls.length,',
    '        idempotency: summarizeRunTrace({ external_tool_calls: externalCalls }).validation.idempotency,',
    '      }) + "\\n")',
    '      throw new Error(\`LETTA_TURN_FAILED: \${finished.error}\`)',
    '    }',
  ].join('\n');
  return source.replace(anchor,replacement);
}
