import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareSkillDelivery, publicSkillUsage } from './runtime_contract.ts';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'skill-provenance-'));
  t.after(() => rm(base, {recursive:true,force:true}));
  const installed = join(base, 'toolboxes', 'agent-runtime');
  const parent = join(base, 'toolboxes', 'superpowers', 'skills', 'systematic-debugging');
  await mkdir(installed, {recursive:true});
  await mkdir(parent, {recursive:true});
  const data = Buffer.from('---\nname: systematic-debugging\n---\n# Verify actual failures\n');
  await writeFile(join(parent,'SKILL.md'), data);
  return {installed,parent,data};
}

test('select, hash, load and prepare exact installed Skill without claiming verified behaviour', async t => {
  const {installed,data} = await fixture(t);
  const item = await prepareSkillDelivery(installed,['superpowers.systematic-debugging']);
  assert.equal(item.records[0].sha256, createHash('sha256').update(data).digest('hex'));
  assert.match(item.promptSuffix, /Verify actual failures/);
  assert.match(item.promptSuffix, /lower priority than the current user/);
  assert.deepEqual(publicSkillUsage(item.records,'running').skills[0].delivery,'worker_input_prepared');
  assert.equal(publicSkillUsage(item.records,'completed').skills[0].delivery,'worker_result_observed');
  assert.equal(publicSkillUsage(item.records,'completed').skills[0].verification,'not_evaluated');
  assert.doesNotMatch(JSON.stringify(item.records), /Verify actual failures/);
});
test('legacy operations distinguish missing evidence from no requested skills', async () => {
  assert.equal(publicSkillUsage(undefined,'completed').state,'not_recorded');
  assert.equal(publicSkillUsage([],'completed').state,'none_selected');
  assert.equal(publicSkillUsage([{id:'fake',sha256:'x',loadState:'loaded',deliveryState:'worker_input_prepared'}],'completed').state,'invalid_record');
});
test('reject traversal, duplicates, uninstalled sources and excessively large skills', async t => {
  const {installed,parent} = await fixture(t);
  for (const ids of [['../secrets'],['superpowers..foo'],['superpowers.systematic-debugging','superpowers.systematic-debugging']])
    await assert.rejects(prepareSkillDelivery(installed,ids),/SKILL_ID_INVALID|SKILL_IDS_DUPLICATE/);
  await assert.rejects(prepareSkillDelivery(installed,['superpowers.missing']),/SKILL_NOT_INSTALLED/);
  await writeFile(join(parent,'SKILL.md'), 'x'.repeat(32769));
  await assert.rejects(prepareSkillDelivery(installed,['superpowers.systematic-debugging']),/SKILL_SOURCE_UNSAFE|SKILL_SIZE_LIMIT/);
});
test('reject linked skill source folders and files', async t => {
  const {installed,parent} = await fixture(t);
  const folder = join(parent,'SKILL.md');
  await rm(folder);
  try {
    await symlink(join(parent,'secret.txt'),folder);
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('Windows disallows symlinks without Developer Mode');
    throw error;
  }
  await assert.rejects(prepareSkillDelivery(installed,['superpowers.systematic-debugging']),/SKILL_SOURCE_UNSAFE/);
});
