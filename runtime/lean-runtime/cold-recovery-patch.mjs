import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = text => createHash('sha256').update(text).digest('hex');
const baseline = {
  'letta_worker.ts': 'b6bc5213a6302d43dae80c36acc9b7e9c1e805db77f10e04db5bcdac2cdc9775',
  'agent_runtime.ts': 'a04524fc14ce8b653b19cc612b8467b289e58525be5b8f2a6d4ad75d335690c4',
  'external_tool_idempotency.ts': 'bd592492f9ea7332ecdb49fade8a80d9915be8ab9d4498c9ce4e38fc23c95c35',
};
const observedWorkflow = {
  'letta_worker.ts': '834aa12f99824e70baf327cfe260f59ea48c38416ed7bc062e134beac042f932',
  'agent_runtime.ts': '5051e4653303b4309416388e9b9d71ed71ec188b1c982ec467644d5595dc3d10',
};
export function patchColdRecovery(original, name) {
  const source = readFileSync(new URL(`./source/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const before = original.replaceAll('\r\n', '\n');
  if (before === source || sha(before) === baseline[name] || sha(before) === observedWorkflow[name]) return source;
  throw Error(`COLD_RECOVERY_SOURCE_CHANGED: ${name}`);
}
