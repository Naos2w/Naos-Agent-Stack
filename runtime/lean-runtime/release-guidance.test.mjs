import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchCurrentReleaseGuidance} from './update-runtime.mjs';

const source=await readFile(new URL('./policy/shared-development-preflight.mdc',import.meta.url),'utf8');
const legacy='# Old deployed guidance\n\n## Bounded task context and declared checks — version 1\n\nOld QA notes; no fresh release check.\n';

test('publisher adds fresh-release guidance even when older Bounded section exists',()=>{
  const result=patchCurrentReleaseGuidance(legacy,source);
  assert.ok(result.startsWith(legacy.trimEnd()));
  assert.match(result,/## Current release evidence — version 1/);
  assert.match(result,/HISTORICAL_RECONCILIATION_PRESERVED/);
  assert.match(result,/本次同一操作真的遭平台拒絕/);
  assert.equal(result.match(/## Current release evidence — version 1/g)?.length,1);
  assert.equal(patchCurrentReleaseGuidance(result,source),result);
});

test('publisher rejects stale, missing or tampered release policy instead of silently trusting it',()=>{
  const result=patchCurrentReleaseGuidance(legacy,source);
  assert.throws(()=>patchCurrentReleaseGuidance(result.replace('HISTORICAL_RECONCILIATION_PRESERVED','RELEASE_IS_BLOCKED'),source),
    /CURRENT_RELEASE_GUIDANCE_CONFLICT/);
  assert.throws(()=>patchCurrentReleaseGuidance(result.replace('<!-- end current release evidence -->',''),source),
    /CURRENT_RELEASE_GUIDANCE_CONFLICT/);
  assert.throws(()=>patchCurrentReleaseGuidance(legacy,'no release evidence section'),
    /CURRENT_RELEASE_GUIDANCE_SOURCE_INVALID/);
});

test('source policy and installer both keep release decisions separate from historical Operation replay',()=>{
  assert.match(source,/舊 403/);
  assert.match(source,/不等於不能維護/);
  assert.match(source,/不能跳過維護鎖/);
  const installedRule=patchCurrentReleaseGuidance(legacy,source);
  const installedSkill=patchCurrentReleaseGuidance('Old runtime skill',source);
  assert.match(installedRule,/只有本次同一操作真的遭平台拒絕/);
  assert.match(installedSkill,/只有本次同一操作真的遭平台拒絕/);
});
