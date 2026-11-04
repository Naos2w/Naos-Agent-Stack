import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { evaluateDurableTurnEvidence } from "./operation_forensics.mjs";

const id = "op_b56e869a38d84720";
const projectId = "houselook", conversationId = "local-conv-50";
const toolCallId = "call-original";
const args = { command: "fixture-readonly", cwd: "." };
const stable = input => Object.fromEntries(Object.entries(input)
  .sort(([a], [b]) => a.localeCompare(b)));
const fingerprint = value => createHash("sha256")
  .update(JSON.stringify(stable(value))).digest("hex");

function fixture() {
  const op = {
    id, engine: "letta", state: "failed", projectId, sessionId: conversationId,
    remoteSettlement: {schema: 1, source: "explicit_cancel", status: "already_idle",
      operationId: id, projectId, conversationId,
      clientMessageId: "openchatx-" + id, observedAt: "2026-11-04T04:56:16Z" },
  };
  const messages = [
    {role: "user", otid: "openchatx-" + id},
    {role: "assistant", stopReason: "toolUse", content: [
      {type: "toolCall", id: "read-original", name: "openchatx_read_file", arguments: {path: "TASK.md"}},
    ]},
    {role: "toolResult", toolCallId: "read-original", toolName: "openchatx_read_file", isError: false},
    {role: "assistant", stopReason: "toolUse", content: [
      {type: "toolCall", id: toolCallId, name: "openchatx_shell", arguments: args},
    ]},
    {role: "toolResult", toolCallId, toolName: "openchatx_shell", isError: true,
      content: [{type: "text", text: "exit_code=1"}]},
  ];
  const ledger = new Map([[toolCallId, {
    projectId, conversationId, toolCallId, toolName: "openchatx_shell",
    state: "completed", inputFingerprint: fingerprint(args),
    result: {is_error: true, content: [{type: "text", text: "exit_code=1"}]},
  }]]);
  return { op, messages, ledger };
}
test("matching original replies and exact durable side-effect claims are reviewable without clearing state", () => {
  const {op, messages, ledger} = fixture();
  const result = evaluateDurableTurnEvidence(op, messages, ledger);
  assert.equal(result.verified, true);
  assert.equal(result.toolCalls, 2);
  assert.equal(result.pairedResults, 2);
  assert.equal(result.completedDurableSideEffects, 1);
  assert.equal(result.failedSideEffectReplies, 1);
  assert.equal(result.mayClearReconciliation, false);
  assert.equal(result.deliveryVerified, false);
});
test("legacy provider error flag bug can be reviewed only with exact ledger content", () => {
  const {op, messages, ledger} = fixture();
  messages.at(-1).isError = false;
  messages.at(-1).content = [
    {type: "text", text: "[approved tool response annotation]"},
    ...structuredClone(ledger.get(toolCallId).result.content),
  ];
  assert.equal(evaluateDurableTurnEvidence(op,messages,ledger).reason,"SIDE_EFFECT_OUTCOME_MISMATCH");
  const result = evaluateDurableTurnEvidence(op,messages,ledger,{historicalErrorFlagBugVerified:true});
  assert.equal(result.verified,true);
  assert.equal(result.historicalProviderErrorFlagLoss,1);
  assert.equal(result.mayClearReconciliation,false);
  messages.at(-1).content.at(-1).text = "altered";
  assert.equal(evaluateDurableTurnEvidence(op,messages,ledger,{historicalErrorFlagBugVerified:true}).reason,
    "SIDE_EFFECT_CONTENT_UNVERIFIED");
});

test("zero-call provider failure is not a fabricated successful turn", () => {
  const {op} = fixture();
  const result = evaluateDurableTurnEvidence(op, [{role: "user",otid:"openchatx-"+id}], new Map());
  assert.equal(result.verified, true);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.terminalAssistantReply, false);
  assert.equal(result.deliveryVerified, false);
  assert.equal(result.mayClearReconciliation, false);
});
test("a missing tool result or mismatched tool name fails closed", () => {
  const {op, messages, ledger} = fixture();
  assert.equal(evaluateDurableTurnEvidence(op,messages.slice(0,-1),ledger).reason,"TOOL_CALLS_IN_FLIGHT");
  const different = structuredClone(messages);
  different.at(-1).toolName = "openchatx_write_file";
  assert.equal(evaluateDurableTurnEvidence(op,different,ledger).reason,"TOOL_RETURN_MISMATCH");
});
test("unknown, missing, uncertain or mismatched side effects cannot be silently reconciled", () => {
  const {op, messages, ledger} = fixture();
  assert.equal(evaluateDurableTurnEvidence(op,messages,new Map()).reason,"SIDE_EFFECT_LEDGER_COVERAGE_UNKNOWN");
  for (const mutation of [
    item => { item.state = "running"; },
    item => { item.conversationId = "local-conv-OTHER"; },
    item => { item.inputFingerprint = "wrong"; },
    item => { delete item.result; },
  ]) {
    const candidate = structuredClone(ledger.get(toolCallId));
    mutation(candidate);
    assert.equal(evaluateDurableTurnEvidence(op,messages,new Map([[toolCallId,candidate]])).reason,
      "SIDE_EFFECT_LEDGER_MISMATCH");
  }
});
test("remote idle alone, newer input and completed assistant response never clear reconciliation", () => {
  const {op, messages, ledger} = fixture();
  delete op.remoteSettlement;
  assert.equal(evaluateDurableTurnEvidence(op,messages,ledger).reason,"REMOTE_IDLE_RECEIPT_UNVERIFIED");
  op.remoteSettlement = fixture().op.remoteSettlement;
  assert.equal(evaluateDurableTurnEvidence(op,[...messages,{role:"user",otid:"new"}],ledger).reason,
    "NEWER_REMOTE_INPUT_PRESENT");
  assert.equal(evaluateDurableTurnEvidence(op,[...messages,
    {role:"assistant",stopReason:"stop",content:[{type:"text",text:"done"}]}],ledger).reason,
    "OPERATION_TERMINAL_RESULT_PRESENT");
});
