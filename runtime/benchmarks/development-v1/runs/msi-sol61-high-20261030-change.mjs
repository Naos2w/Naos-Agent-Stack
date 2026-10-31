// One-time, user-requested MSI Agent setting change. No global defaults or PC2.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { acquireRuntimeMaintenance } from '../../../lean-runtime/runtime_maintenance.mjs';
import { inspectRuntimeReadiness } from '../../../lean-runtime/runtime_readiness.mjs';

const toolbox = 'C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime';
const cwd = 'C:/Naos/02.Git/personal/Letta-POC';
const agent = 'agent-local-31166c4b-56a4-4e39-9bdb-04a2ed91e41c';
const conversation = 'local-conv-84';
const target = 'openai-codex/gpt-6.1-sol';
const effort = value => value.model_settings?.reasoning?.reasoning_effort ?? value.model_settings?.reasoning_effort;
function cli(args) {
  return JSON.parse(execFileSync(process.execPath, [cwd + '/node_modules/@letta-ai/letta-code/letta.js', 'model', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
  }));
}
const readiness = await inspectRuntimeReadiness(toolbox);
assert.equal(readiness.ready, true, JSON.stringify(readiness));
const release = await acquireRuntimeMaintenance(toolbox);
try {
  const operations = JSON.parse(await readFile(toolbox + '/operations.json', 'utf8'));
  assert.ok(Object.values(operations).every(item => ['completed', 'failed', 'cancelled'].includes(item.state)), 'active or unknown operation');
  const before = cli(['get', '--agent', agent]);
  const conversationBefore = cli(['get', '--conversation', conversation]);
  assert.equal(before.model, 'openai-codex/gpt-5.6-sol');
  assert.equal(effort(before), 'low');
  assert.equal(before.model_settings.provider_type, 'chatgpt_oauth');
  assert.equal(conversationBefore.model, before.model);
  assert.equal(effort(conversationBefore), 'low');
  const record = { changedAt: new Date().toISOString(), agent, conversation, before, conversationBefore,
    requested: { model: target, reasoning: 'high' }, scope: 'MSI existing Letta-POC Agent only' };
  await writeFile(new URL('./msi-sol61-high-20261030-a.config-before.json', import.meta.url), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  cli(['set', target, '--reasoning', 'high', '--agent', agent]);
  const after = cli(['get', '--agent', agent]);
  assert.equal(after.model, target);
  assert.equal(effort(after), 'high');
  assert.equal(after.model_settings.provider_type, 'chatgpt_oauth');
  let conversationAfter = cli(['get', '--conversation', conversation]);
  let conversationOverrideUpdated = false;
  if (conversationAfter.model !== target || effort(conversationAfter) !== 'high') {
    cli(['set', target, '--reasoning', 'high', '--conversation', conversation]);
    conversationAfter = cli(['get', '--conversation', conversation]);
    conversationOverrideUpdated = true;
  }
  assert.equal(conversationAfter.model, target);
  assert.equal(effort(conversationAfter), 'high');
  assert.equal(conversationAfter.model_settings.provider_type, 'chatgpt_oauth');
  await writeFile(new URL('./msi-sol61-high-20261030-a.config-after.json', import.meta.url), JSON.stringify({
    ...record, after, conversationAfter, conversationOverrideUpdated,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ model: after.model, reasoning: effort(after), provider: after.model_settings.provider_type,
    conversationModel: conversationAfter.model, conversationReasoning: effort(conversationAfter), conversationOverrideUpdated }));
} finally { await release(); }
