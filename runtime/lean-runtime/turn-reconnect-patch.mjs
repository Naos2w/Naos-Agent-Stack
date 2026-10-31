import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const candidate = readFileSync(new URL('./source/letta_worker.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

export function patchTurnReconnectWorker(original) {
  let text = original.replaceAll('\r\n', '\n');
  for (const [start, end, expected] of [
    ['function registerApprovalHandler(', '\nclass LettaSocket', 'ae18646a77aa02a4c787eaeca20f60fb9a3ae31a15062191f2c0a529433cb275'],
    ['class LettaSocket {', '\nasync function withClient', 'c02163ec5bfe47c34348a9c74c9c3061f1ddf98684d85ebad4f8534874241b33'],
    ['async function runTurn(', '\nfunction summarizeRunTrace', 'eb11df1bce0e3d9233bdb587f59b3765699b0ab59cb4099523e15d69562243d3'],
  ]) {
    const a = text.indexOf(start), b = text.indexOf(end, a);
    const ca = candidate.indexOf(start), cb = candidate.indexOf(end, ca);
    if (a < 0 || b <= a || ca < 0 || cb <= ca || text.indexOf(start, a + start.length) >= 0) throw Error('TURN_RECONNECT_SOURCE_CHANGED');
    const next = candidate.slice(ca, cb), before = text.slice(a, b);
    if (before === next) continue;
    if (digest(before) !== expected) throw Error('TURN_RECONNECT_SOURCE_CHANGED');
    text = text.slice(0, a) + next + text.slice(b);
  }
  return text;
}
