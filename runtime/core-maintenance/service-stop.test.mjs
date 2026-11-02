import test from 'node:test';
import assert from 'node:assert/strict';
import {stopServiceForUpdate} from './apply-audit-diagnostics.mjs';

const app = (status, pid = 0) => ({pid, pm2_env: {status}});
async function exercise(states) {
  let stops = 0;
  await stopServiceForUpdate({
    stop: async () => { stops++; },
    inspect: async () => states.shift(),
    wait: async () => {},
  });
  return stops;
}
test('verified stop needs one command; delayed PM2 exit label needs exactly two', async () => {
  assert.equal(await exercise([app('stopped')]), 1);
  assert.equal(await exercise([app('waiting restart'), app('stopped')]), 2);
});
test('live PID, online state and unresolved delayed state never authorize replacement', async () => {
  for (const states of [[app('stopped', 123)], [app('waiting restart', 123)],
    [app('online')], [app('waiting restart'), app('waiting restart')]]) {
    await assert.rejects(exercise(states), /AUDIT_UPDATE_STOP_UNVERIFIED/);
  }
});
