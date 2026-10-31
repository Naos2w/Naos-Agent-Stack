function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error('Context path anchor missing or ambiguous: ' + before.slice(0, 100));
  return text.replace(before, after);
}
export function patchContextWorker(text) {
  if (text.includes('inspectDevelopmentContext, input.taskRef, input.contextPaths)')) return text;
  text=once(text,'  modelSelection?: Record<string, unknown>\n  runId?: string','  modelSelection?: Record<string, unknown>\n  contextPaths?: string[]\n  runId?: string');
  text=once(text,'inspectDevelopmentContext, input.taskRef)','inspectDevelopmentContext, input.taskRef, input.contextPaths)');
  return text;
}
export function patchContextRuntime(text) {
  if (text.includes('const contextPaths = normalizeContextPaths(context_paths)')) return text;
  text=once(text,'publicTokenUsage, assertLettaModelSelection }','publicTokenUsage, assertLettaModelSelection, normalizeContextPaths }');
  text=once(text,'  modelSelection?: Record<string, unknown>\n  reconciliation?', '  modelSelection?: Record<string, unknown>\n  contextPaths?: string[]\n  reconciliation?');
  text=once(text,'  modelSelection?: Record<string, unknown>\n}) {','  modelSelection?: Record<string, unknown>\n  contextPaths?: string[]\n}) {');
  text=once(text,'timeoutMs, taskRef, modelSelection } = args','timeoutMs, taskRef, modelSelection, contextPaths } = args');
  text=once(text,'      modelSelection,\n      taskRef,','      modelSelection,\n      contextPaths,\n      taskRef,');
  text=once(text,'      inputPath,\n      modelSelection,','      inputPath,\n      contextPaths,\n      modelSelection,');
  text=once(text,'    task_ref: z.string().trim().min(1).max(512).optional(),',
    '    task_ref: z.string().trim().min(1).max(512).optional(),\n' +
    '    context_paths: z.array(z.string().min(1).max(512)).max(16).optional().describe("run only: known exact files relevant to this task, relative to the Project root. No directories, globs or traversal. Enables bounded per-file index freshness/coverage checks; not a write allowlist or permission grant. Omit when files are not yet known."),');
  text=once(text,'    task_ref,\n    reasoning_effort,','    task_ref,\n    context_paths,\n    reasoning_effort,');
  text=once(text,'    return withRuntimeActivity(TOOLBOX_ROOT, async () => {\n    const config = await ensureConfig()',
    '    return withRuntimeActivity(TOOLBOX_ROOT, async () => {\n    if (action !== "run" && context_paths !== undefined) throw new Error("CONTEXT_PATHS_RUN_ONLY")\n    const config = await ensureConfig()');
  text=once(text,'      const taskRef = normalizeTaskRef(task_ref)','      const taskRef = normalizeTaskRef(task_ref)\n      const contextPaths = normalizeContextPaths(context_paths)');
  text=once(text,'              modelSelection,\n            })','              modelSelection,\n              contextPaths,\n            })');
  text=once(text,'        modelSelection: publicModelSelection(operation.modelSelection),\n        state: operation.state,',
    '        modelSelection: publicModelSelection(operation.modelSelection),\n        contextPaths: operation.contextPaths ?? [],\n        state: operation.state,');
  return text;
}

export function patchContextGuidance(text) {
  if (text.includes('## Exact-file context — version 1')) return text;
  return text.trimEnd()+`\n\n## Exact-file context — version 1

- On run, pass context_paths for up to 16 known relevant files relative to the Project root. Use observed paths, not guessed names; omit when unknown. These hints never grant write access or create acceptance requirements.
- Runtime checks only these files against the matching index scopes. Coverage is best-effort metadata at observation time, not proof of complete or current code. Always read actual source before editing; metadata_changed is a warning, not proof the contents changed.
- For files discovered later, use openchatx_codebase_context with action=coverage and paths. Do not request directories or rescan/reindex the entire project. Query errors, missing files and absent indexes require honest diagnostics and authorized source inspection, not automatic retries or an extra Agent.
`;
}
