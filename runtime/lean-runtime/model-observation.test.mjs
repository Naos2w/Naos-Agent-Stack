import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { publicModelSelection, planModelSelection } from './model_routing.mjs';
import { describeModelConfiguration, publicModelConfiguration, publicTokenUsage,
  assertLettaModelSelection, describeOperationOutcome } from './runtime_contract.ts';
const when = '2026-10-30T01:00:00.000Z';
const agent = { model: 'openai-codex/gpt-6.1-sol',
  model_settings: { reasoning: { reasoning_effort: 'high' }, api_key: 'private-key' },
  llm_config: { model: 'gpt-6.1-sol', reasoning_effort: 'medium', context_window: 128000,
    model_endpoint: 'https://private-endpoint' }, memory: 'private-memory' };

test('effective model prefers current Agent settings and exposes no private configuration', () => {
  const result = describeModelConfiguration(agent, when);
  assert.equal(result.effectiveModel, agent.model);
  assert.equal(result.reasoningEffort, 'high');
  assert.equal(result.reasoningSource, 'model_settings.reasoning');
  assert.equal(result.contextWindow, 128000);
  assert.equal(result.observedAt, when);
  assert.equal(result.scope, 'before_turn');
  assert.doesNotMatch(JSON.stringify(result), /private-|api_key|model_endpoint|memory/);
  assert.deepEqual(publicModelConfiguration({ ...result, secret: 'private' }), result);
});
test('unknown and provider-default reasoning remain distinct with no invented model', () => {
  const unknown = describeModelConfiguration({}, when);
  assert.equal(unknown.effectiveModel, null);
  assert.equal(unknown.reasoningState, 'unavailable');
  assert.deepEqual(publicModelConfiguration(unknown), unknown);
  const defaults = describeModelConfiguration({llm_config: {model: 'fixture', reasoning_effort: null}}, when);
  assert.equal(defaults.reasoningState, 'provider_default');
  assert.equal(defaults.reasoningEffort, null);
  assert.deepEqual(publicModelConfiguration(defaults), defaults);
});
test('untrusted model text, dates and usage cannot add private output or imply zero usage', () => {
  assert.equal(describeModelConfiguration({model: 'secret\nline', llm_config: {context_window: -1}}, when).effectiveModel, null);
  assert.equal(publicModelConfiguration({version: 1, observedAt: 'private'}), null);
  assert.equal(publicTokenUsage({prompt_tokens: -1, output_tokens: Infinity, secret: 'private'}), null);
  assert.deepEqual(publicTokenUsage({prompt_tokens: 3, completion_tokens: 0, total_tokens: 3, secret: 'private'}),
    {prompt_tokens: 3, completion_tokens: 0, total_tokens: 3});
});
test('unsupported Letta model selection fails explicitly instead of silently doing nothing', () => {
  assert.doesNotThrow(() => assertLettaModelSelection());
  assert.doesNotThrow(() => assertLettaModelSelection('letta/agent-config'));
  assert.throws(() => assertLettaModelSelection('some-other-model'), /LETTA_MODEL_SELECTION_UNSUPPORTED/);
});
async function sourceFunction(file, name) {
  const text = await readFile(new URL('./source/' + file, import.meta.url), 'utf8');
  const start = text.indexOf('async function ' + name + '(');
  const next = /\n(?:export )?(?:async )?function /.exec(text.slice(start + 1));
  assert.ok(start >= 0 && next);
  return stripTypeScriptTypes(text.slice(start, start + 1 + next.index), {mode: 'transform'});
}
test('actual worker retrieves existing model configuration without modifying the Agent', async () => {
  const body = await sourceFunction('letta_worker.ts', 'ensureWorkerAgent');
  const calls = [];
  const client = {nextRequestId: () => 'fixture', request: async request => {
    calls.push(request.type); return {success: true, agent};
  }};
  const run = new Function('withClient', 'requireSuccess', 'describeModelConfiguration', 'configureNewAgentModel',
    body + '\nreturn ensureWorkerAgent({}, "agent-fixture");');
  const result = await run(fn => fn(client), response => assert.equal(response.success, true),
    describeModelConfiguration, () => {throw Error('Existing Agent must not be modified');});
  assert.equal(result.agentId, 'agent-fixture');
  assert.equal(result.modelConfiguration.reasoningEffort, 'high');
  assert.deepEqual(calls, ['agent_retrieve']);
});
for (const stale of [false, true]) test(`actual facade poll preserves model and usage, stale=${stale}`, async () => {
  const body = await sourceFunction('agent_runtime.ts', 'pollOperation');
  const observation = describeModelConfiguration(agent, when);
  const parsed = {ok: true, sessionId: 'conv-fixture', agentId: 'agent-fixture', assistantText: 'done',
    modelConfiguration: observation, modelSelection: {...planModelSelection(),state:'applied'}, usage: {prompt_tokens: 21, total_tokens: 34, private: 'omit'}};
  const operation = {id: 'op-fixture', projectId: 'fixture', sessionName: 'main', state: 'completed',
    engine: 'letta', model: 'letta/agent-config', stdoutPath: 'out', stderrPath: 'err'};
  const session = {name: 'main', lastOperationId: stale ? 'new-op' : operation.id,
    modelConfiguration: {version: 'newer-sentinel'}};
  const state = {sessions: {main: session}};
  const dependencies = {
    readOperations: async () => ({[operation.id]: operation}),
    isProcessRunning: () => false, readText: async path => path === 'out' ? JSON.stringify(parsed) : '',
    ensureState: async () => state, ensureProjectState: x => x, ensureConfig: async () => ({}),
    parseLettaWorkerOutput: JSON.parse, summarizeReconciliation: () => ({requiresReconciliation: false}),
    updateOperation: async (_, patch) => Object.assign(operation, patch),
    withSessionStateLock: fn => fn(), ensureSession: () => session,
    isCurrentSessionOperation: s => s.lastOperationId === operation.id,
    DEFAULT_LETTA_MODEL: 'letta/agent-config', DEFAULT_MAX_RESULT_CHARS: 6000,
    now: () => when, saveState: async () => {}, publicModelConfiguration, publicTokenUsage, publicModelSelection,
    clipResultText: text => ({text, truncated: false}), describeOperationOutcome,
  };
  const run = new Function(...Object.keys(dependencies), body + '\nreturn pollOperation({id:"fixture"}, "op-fixture");');
  const result = await run(...Object.values(dependencies));
  assert.deepEqual(result.modelConfiguration, observation);
  assert.deepEqual(result.usage, {prompt_tokens: 21, total_tokens: 34});
  assert.equal(result.stalePoll, stale);
  assert.deepEqual(result.modelSelection, parsed.modelSelection);
  assert.deepEqual(session.modelSelection, stale ? undefined : parsed.modelSelection);
  assert.deepEqual(session.modelConfiguration, stale ? {version: 'newer-sentinel'} : observation);
  assert.equal(result.delivery.acceptanceVerified, false);
});
