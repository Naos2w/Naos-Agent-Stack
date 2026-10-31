import { describeModelConfiguration } from './runtime_contract.ts';

const profiles = {
  simple: { model: 'openai-codex/gpt-6-luna', effort: 'medium' },
  standard: { model: 'openai-codex/gpt-6.1-sol', effort: 'high' },
  complex: { model: 'openai-codex/gpt-6-astra', effort: 'high' },
};
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const modelPattern = /^openai-codex\/[a-z0-9][a-z0-9.-]{1,95}$/;

// The supervising conversation classifies the approved task. No second model,
// keyword classifier, hidden retry, or provider/billing-route switch is involved.
export function planModelSelection({ model, reasoningEffort, taskComplexity } = {}) {
  if (taskComplexity !== undefined && !Object.hasOwn(profiles, taskComplexity))
    throw Error('MODEL_TASK_COMPLEXITY_INVALID');
  if (reasoningEffort !== undefined && !efforts.includes(reasoningEffort))
    throw Error('MODEL_REASONING_INVALID');
  if (model !== undefined && (typeof model !== 'string' || model !== model.trim()))
    throw Error('MODEL_HANDLE_INVALID');
  if (model === 'letta/agent-config') {
    if (reasoningEffort !== undefined || taskComplexity !== undefined) throw Error('MODEL_SELECTION_CONFLICT');
    return { version: 1, mode: 'preserve', taskComplexity: null, selectedModel: null,
      reasoningEffort: null, reason: 'KEEP_CURRENT_CONVERSATION', effortSource: 'existing',
      scope: 'conversation', state: 'planned' };
  }
  const complexity = taskComplexity ?? 'standard';
  const explicit = model !== undefined && model !== '' && model !== 'auto';
  const selectedModel = explicit ? (model.startsWith('gpt-') ? 'openai-codex/' + model : model) : profiles[complexity].model;
  if (!modelPattern.test(selectedModel)) throw Error('MODEL_HANDLE_UNSUPPORTED');
  return { version: 1, mode: explicit ? 'explicit' : 'auto', taskComplexity: complexity,
    selectedModel, reasoningEffort: reasoningEffort ?? (explicit ? 'high' : profiles[complexity].effort),
    reason: explicit ? 'USER_SELECTED_MODEL' : taskComplexity ? 'TASK_' + complexity.toUpperCase() : 'DEFAULT_STANDARD',
    effortSource: reasoningEffort ? 'user' : 'policy', scope: 'conversation', state: 'planned' };
}

export function publicModelSelection(value) {
  if (value?.version !== 1 || !['auto', 'explicit', 'preserve'].includes(value.mode) ||
      !['planned', 'applied'].includes(value.state) || value.scope !== 'conversation') return null;
  try {
    const planned = planModelSelection(value.mode === 'preserve' ? { model: 'letta/agent-config' } : {
      ...(value.mode === 'explicit' ? { model: value.selectedModel } : {}),
      ...(value.reason !== 'DEFAULT_STANDARD' ? { taskComplexity: value.taskComplexity } : {}),
      ...(value.effortSource === 'user' ? { reasoningEffort: value.reasoningEffort } : {}),
    });
    for (const key of ['selectedModel', 'reasoningEffort', 'reason', 'effortSource', 'taskComplexity']) {
      if (planned[key] !== value[key]) return null;
    }
    return { ...planned, state: value.state };
  } catch { return null; }
}

function requireSuccess(response, code) {
  if (response?.success !== true) throw Error(code);
}
function reasoning(settings) { return settings?.reasoning?.reasoning_effort ?? settings?.reasoning_effort; }

async function readScope(client, runtime) {
  const agentReply = await client.request({ type: 'agent_retrieve',
    request_id: client.nextRequestId('route-agent'), agent_id: runtime.agent_id }, 'agent_retrieve_response');
  requireSuccess(agentReply, 'MODEL_AGENT_READ_FAILED');
  const reply = await client.request({ type: 'conversation_retrieve',
    request_id: client.nextRequestId('route-conversation'), conversation_id: runtime.conversation_id }, 'conversation_retrieve_response');
  requireSuccess(reply, 'MODEL_CONVERSATION_READ_FAILED');
  const agent = agentReply.agent, conversation = reply.conversation;
  if (!agent || !conversation || conversation.agent_id !== runtime.agent_id || conversation.id !== runtime.conversation_id)
    throw Error('MODEL_CONVERSATION_OWNER_MISMATCH');
  const settings = conversation.model_settings ?? agent.model_settings;
  const model = conversation.model ?? agent.model;
  return { model, settings, agent, conversation,
    observation: describeModelConfiguration({ model, model_settings: settings,
      llm_config: { context_window: conversation.context_window_limit ?? settings?.context_window_limit ?? agent.llm_config?.context_window,
        reasoning_effort: reasoning(settings) } }, new Date().toISOString(), 'letta.conversation_retrieve') };
}

// Called after binding the persisted conversation and before sending input.
// Only conversation overrides are changed. A rejected/uncertain selection stops
// this operation; it never retries inference on a different model.
export async function applyConversationModelSelection(client, runtime, selection, assertIdle) {
  const planned = publicModelSelection(selection);
  if (!planned || planned.state !== 'planned') throw Error('MODEL_SELECTION_INVALID');
  if (!runtime?.agent_id || !runtime?.conversation_id || runtime.conversation_id === 'default')
    throw Error('MODEL_PERSISTED_CONVERSATION_REQUIRED');
  await assertIdle();
  const before = await readScope(client, runtime);
  if (planned.mode === 'preserve') return { modelSelection: { ...planned, state: 'applied' }, modelConfiguration: before.observation };
  if (!before.model?.startsWith('openai-codex/') || before.settings?.provider_type !== 'chatgpt_oauth')
    throw Error('MODEL_ROUTING_PROVIDER_MISMATCH');
  const catalog = await client.request({ type: 'list_models', request_id: client.nextRequestId('route-catalog') }, 'list_models_response');
  requireSuccess(catalog, 'MODEL_CATALOG_UNAVAILABLE');
  if (!Array.isArray(catalog.entries)) throw Error('MODEL_CATALOG_UNAVAILABLE');
  const matching = catalog.entries.filter(entry => entry.handle === planned.selectedModel);
  if (!matching.length || !Array.isArray(catalog.available_handles) ||
      !catalog.available_handles.includes(planned.selectedModel))
    throw Error('MODEL_NOT_AVAILABLE');
  // Effort-specific catalog IDs are authoritative for this installed provider.
  const entry = matching.find(entry => entry.updateArgs?.reasoning_effort === planned.reasoningEffort);
  if (!entry || typeof entry.id !== 'string') throw Error('MODEL_REASONING_NOT_AVAILABLE');
  await assertIdle();
  if (before.model !== planned.selectedModel || reasoning(before.settings) !== planned.reasoningEffort) {
    const applied = await client.request({ type: 'update_model', request_id: client.nextRequestId('route-apply'), runtime,
      payload: { model_id: entry.id, model_handle: planned.selectedModel, reasoning_effort: planned.reasoningEffort } }, 'update_model_response');
    requireSuccess(applied, 'MODEL_SELECTION_APPLY_FAILED');
    if (applied.applied_to !== 'conversation' || applied.runtime?.agent_id !== runtime.agent_id ||
        applied.runtime?.conversation_id !== runtime.conversation_id) throw Error('MODEL_SELECTION_SCOPE_UNVERIFIED');
  }
  const after = await readScope(client, runtime);
  if (after.model !== planned.selectedModel || reasoning(after.settings) !== planned.reasoningEffort ||
      after.settings?.provider_type !== 'chatgpt_oauth') throw Error('MODEL_SELECTION_VERIFY_FAILED');
  if (JSON.stringify([after.agent.model, after.agent.model_settings]) !== JSON.stringify([before.agent.model, before.agent.model_settings]))
    throw Error('MODEL_AGENT_DEFAULT_CHANGED');
  await assertIdle();
  return { modelSelection: { ...planned, state: 'applied' }, modelConfiguration: after.observation };
}
