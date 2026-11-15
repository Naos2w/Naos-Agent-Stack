function replaceOnce(text, before, after) {
  const pieces = text.split(before);
  if (pieces.length !== 2) throw Error('SKILL_PATCH_ANCHOR_MISSING_OR_DUPLICATE: ' + before.slice(0, 55));
  return pieces.join(after);
}
export function patchSkillRuntime(original) {
  if (original.includes('prepareSkillDelivery(') && original.includes('publicSkillUsage(')) return original;
  let s = original.replaceAll('\r\n','\n');
  s = replaceOnce(s,
    'const { describeOperationOutcome, normalizeTaskRef, publicModelConfiguration, publicTokenUsage, assertLettaModelSelection, normalizeContextPaths, normalizeAcceptanceChecks } = await import(runtimeContractUrl.href)',
    'const { describeOperationOutcome, normalizeTaskRef, publicModelConfiguration, publicTokenUsage, assertLettaModelSelection, normalizeContextPaths, normalizeAcceptanceChecks, prepareSkillDelivery, publicSkillUsage } = await import(runtimeContractUrl.href)');
  s = replaceOnce(s,
    '  acceptanceChecks?: ReturnType<typeof normalizeAcceptanceChecks>\n}) {\n  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection, contextPaths, acceptanceChecks } = args',
    '  acceptanceChecks?: ReturnType<typeof normalizeAcceptanceChecks>\n' +
    '  skillProvenance?: Array<Record<string, unknown>>\n' +
    '}) {\n  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection, contextPaths, acceptanceChecks, skillProvenance } = args');
  s = replaceOnce(s,'      taskRef,\n      prompt,\n      timeoutMs,','      taskRef,\n      skillProvenance,\n      prompt,\n      timeoutMs,');
  s = replaceOnce(s,'      taskRef: taskRef ?? null,\n      state: "running",',
    '      taskRef: taskRef ?? null,\n      skillProvenance,\n      state: "running",');
  s = replaceOnce(s,'  acceptanceChecks?: ReturnType<typeof normalizeAcceptanceChecks>\n  reconciliation?: Record<string, any>',
    '  acceptanceChecks?: ReturnType<typeof normalizeAcceptanceChecks>\n  skillProvenance?: Array<Record<string, unknown>>\n  reconciliation?: Record<string, any>');
  s = replaceOnce(s,
    '    context_paths: z.array(z.string().min(1).max(512)).max(16).optional().describe("run only:',
    '    skill_ids: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}\\.[a-z][a-z0-9-]{0,63}$/)).max(4).optional().describe("run only: installed Skill IDs to load, hash and include in this Letta Operation. Not evidence of compliance or acceptance."),\n' +
    '    context_paths: z.array(z.string().min(1).max(512)).max(16).optional().describe("run only:');
  s = replaceOnce(s,'    context_paths,\n    acceptance_checks,','    context_paths,\n    acceptance_checks,\n    skill_ids,');
  s = replaceOnce(s,'    if (action !== "run" && context_paths !== undefined) throw new Error("CONTEXT_PATHS_RUN_ONLY")',
    '    if (action !== "run" && skill_ids !== undefined) throw new Error("SKILL_IDS_RUN_ONLY")\n' +
    '    if (action !== "run" && context_paths !== undefined) throw new Error("CONTEXT_PATHS_RUN_ONLY")');
  s = replaceOnce(s,'      const runtimePrompt = prompt.trim()',
    '      const skillDelivery = await prepareSkillDelivery(TOOLBOX_ROOT, skill_ids)\n' +
    '      const runtimePrompt = prompt.trim() + skillDelivery.promptSuffix');
  s = replaceOnce(s,'              acceptanceChecks,\n            })',
    '              acceptanceChecks,\n              skillProvenance: skillDelivery.records,\n            })');
  s = replaceOnce(s,'      state: "running" as const,\n      modelSelection:',
    '      state: "running" as const,\n      skillUsage: publicSkillUsage(operation.skillProvenance, "running"),\n      modelSelection:');
  s = replaceOnce(s,'      operationId: operation.id,\n      projectId: project.id,\n      sessionName: operation.sessionName,\n      state: operation.state,',
    '      operationId: operation.id,\n      projectId: project.id,\n      sessionName: operation.sessionName,\n      state: operation.state,\n      skillUsage: publicSkillUsage(operation.skillProvenance, operation.state),');
  s = replaceOnce(s,'          updatedAt: item.updatedAt,\n        }))',
    '          updatedAt: item.updatedAt,\n          skillUsage: publicSkillUsage(item.skillProvenance, item.state),\n        }))');
  s = replaceOnce(s,'        operationId: operation.id,\n        model: chosenModel,',
    '        operationId: operation.id,\n        skillUsage: publicSkillUsage(operation.skillProvenance, operation.state),\n        model: chosenModel,');
  return s;
}
