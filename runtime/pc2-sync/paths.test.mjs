import test from 'node:test';
import assert from 'node:assert/strict';
import {targetPath} from './prepare.mjs';
const roots={runtime:'C:/owned/runtime',headless:'C:/owned/headless'};
test('PC2 migration keeps targets within reviewed code scopes and excludes account/session data',()=>{
  for(const row of [{root:'other',path:'dist/x.js'},{root:'headless',path:'../config.json'},{root:'headless',path:'toolboxes/agent-runtime/config.json'},{root:'headless',path:'toolboxes/agent-runtime/state.json'},{root:'headless',path:'config/codebase-index.json'},{root:'runtime',path:'C:/private'},{root:'runtime',path:'dist/../config.js'},{root:'runtime',path:'dist\\config.js'}])assert.throws(()=>targetPath(roots,row),/SYNC_/);
  assert.match(targetPath(roots,{root:'headless',path:'toolboxes/agent-runtime/tools/agent_runtime.ts'}),/agent_runtime\.ts$/);
});
