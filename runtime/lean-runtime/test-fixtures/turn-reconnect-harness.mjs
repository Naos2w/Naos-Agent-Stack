import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as evidence from '../tool_evidence.mjs';
import { executeSideEffectOnce, isSideEffectingExternalTool, readCompletedToolResult } from '../source/external_tool_idempotency.ts';
const source = await readFile(new URL('../source/letta_worker.ts', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b <= a) throw Error('Missing worker source section');
  return source.slice(a, b);
}
const body = stripTypeScriptTypes(
  section('function registerApprovalHandler(', '\nasync function createConversation(') +
  section('async function runTurn(', '\nfunction summarizeRunTrace('), {mode: 'transform'});

// Exercise shipped transport, approval, execution and turn code. Only the
// project fixture, model selection and environment are supplied by the test.
export function workerHarness(overrides = {}) {
  const dependencies = {
    ...evidence, executeSideEffectOnce, isSideEffectingExternalTool, readCompletedToolResult,
    SERVER_URL: 'ws://fixture', REQUEST_TIMEOUT_MS: 1000,
    externalToolDefinitions: () => [{name: 'openchatx_shell', description: 'Append the fixed fixture marker once.',
      parameters: {type: 'object', properties: {}, additionalProperties: false}, timeout_ms: 10000, auto_background: false}],
    decideExternalToolApproval: async () => ({behavior: 'allow', updated_input: null, selected_permission_suggestion_ids: []}),
    decideProjectToolApproval: () => {throw Error('Unexpected file observation');},
    isProjectToolName: name => name === 'openchatx_shell', isCapabilityTool: () => false,
    applyConversationModelSelection: async () => ({}), planModelSelection: () => ({}),
    summarizeRunTrace: () => ({validation: {idempotency: []}}),
    recoverTimedOutRun: async () => ({status: 'uncertain', reason: 'FIXTURE_STOPPED'}),
    truncate: text => ({text, truncated: false}),
    ...overrides,
  };
  return new Function(...Object.keys(dependencies), body + '\nreturn {runTurn, LettaSocket, runtimeMatches};')(...Object.values(dependencies));
}
