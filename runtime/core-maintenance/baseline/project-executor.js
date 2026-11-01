import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { MCP_CONFIG } from "../config.js";
import { ProjectRegistry, projectRoots as registeredProjectRoots } from "./project-registry.js";

const execFileAsync = promisify(execFile);
const registry = new ProjectRegistry();

export const PROJECT_EXECUTOR_API_VERSION = 1;
export const SHELL_POLICY_VERSION = 2;

export const PROJECT_TOOL_NAMES = new Set([
    "openchatx_read_file",
    "openchatx_write_file",
    "openchatx_shell",
]);

export async function getProject(projectId) {
    try {
        return await registry.get(projectId);
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith("Unknown project ")) {
            throw new Error(`PROJECT_NOT_REGISTERED: ${projectId}`);
        }
        throw error;
    }
}

function requirePermission(project, permission) {
    if (!project.permissions?.[permission]) {
        throw new Error(`PROJECT_PERMISSION_DENIED: ${project.id} requires ${permission} permission`);
    }
}

function projectRoots(project) {
    return registeredProjectRoots(project).map((item) => resolve(item));
}

function isWithin(root, target) {
    const rel = relative(root, target);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveProjectPath(project, input) {
    if (!input?.trim() || input.includes("\0"))
        throw new Error("PATH_INVALID");
    const target = resolve(isAbsolute(input) ? input : join(project.path, input));
    if (!projectRoots(project).some((root) => isWithin(root, target))) {
        throw new Error(`PATH_OUTSIDE_PROJECT: ${input}`);
    }
    return target;
}

async function realProjectRoots(project) {
    return Promise.all(projectRoots(project).map(async (root) => {
        try {
            return await fs.realpath(root);
        }
        catch {
            return root;
        }
    }));
}

async function assertRealPathAllowed(project, target, allowMissing) {
    const roots = await realProjectRoots(project);
    try {
        const actual = await fs.realpath(target);
        if (!roots.some((root) => isWithin(root, actual)))
            throw new Error(`PATH_OUTSIDE_PROJECT: ${target}`);
        return actual;
    }
    catch (error) {
        const code = error?.code;
        if (code !== "ENOENT" || !allowMissing)
            throw error;
        let current = dirname(target);
        while (true) {
            try {
                const actualParent = await fs.realpath(current);
                if (!roots.some((root) => isWithin(root, actualParent)))
                    throw new Error(`PATH_OUTSIDE_PROJECT: ${target}`);
                return target;
            }
            catch (parentError) {
                if (parentError?.code !== "ENOENT")
                    throw parentError;
                const next = dirname(current);
                if (next === current)
                    throw new Error(`PATH_OUTSIDE_PROJECT: ${target}`);
                current = next;
            }
        }
    }
}

function truncate(value, max) {
    if (value.length <= max)
        return { text: value, truncated: false };
    return { text: `${value.slice(0, max)}\n…[truncated]`, truncated: true };
}

function collectAbsolutePathCandidates(command) {
    const found = new Set();
    const quotedWindows = /["']([A-Za-z]:[\\/][^"']+)["']/gu;
    const unquotedWindows = /(?:^|[\s=(:,])([A-Za-z]:[\\/][^\s"'`|;&<>)]*)/gu;
    const quotedUnc = /["'](\\\\[^"']+)["']/gu;
    const unquotedUnc = /(?:^|[\s=(:,])(\\\\[^\s"'`|;&<>)]*)/gu;
    for (const pattern of [quotedWindows, unquotedWindows, quotedUnc, unquotedUnc]) {
        for (const match of command.matchAll(pattern)) {
            const candidate = match[1]?.trim();
            if (candidate)
                found.add(candidate);
        }
    }
    return [...found];
}

// Windows Project root ↔ WSL DrvFS root. This is a scoped path check,
// not an authorization to launch an unrestricted Linux interpreter.
function toWslDrvFsRoot(root) {
    const match = /^([A-Za-z]):[\\/](.*)$/.exec(root);
    if (!match) return null;
    return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`.replace(/\/+$/, "");
}

// Keep a single argv representation for WSL validation and execution.
// Never send a validated WSL command back through PowerShell -Command.
function tokenizeWslCommand(command) {
    const words = [];
    let current = "";
    let quoted = null;
    let started = false;
    for (const char of command) {
        if (quoted) {
            if (char === quoted) quoted = null;
            else current += char;
        }
        else if (char === '"' || char === "'") {
            quoted = char;
            started = true;
        }
        else if (/\s/u.test(char)) {
            if (started) words.push(current);
            started = false;
            current = "";
        }
        else {
            current += char;
            started = true;
        }
    }
    if (quoted) throw new Error("SHELL_POLICY_WSL_UNBALANCED_QUOTES_DENIED");
    if (started) words.push(current);
    if (!/^wsl(?:\.exe)?$/iu.test(words[0] ?? "")) {
        throw new Error("SHELL_POLICY_WSL_COMMAND_CHAIN_DENIED");
    }
    return words;
}

async function validateWslProjectArguments(project, command) {
    const invocations = [...command.matchAll(/\bwsl(?:\.exe)?\b[^\r\n;|&]*/giu)];
    if (!invocations.length) return;
    // A Project WSL operation must be one independently validated command,
    // without PowerShell statements, pipes or redirection in its input.
    if (!/^wsl(?:\.exe)?\s/iu.test(command) ||
        /[;|&<>\r\n]/u.test(command)) {
        throw new Error("SHELL_POLICY_WSL_COMMAND_CHAIN_DENIED");
    }
    const allowed = projectRoots(project)
        .map(toWslDrvFsRoot)
        .filter(Boolean)
        .map(value => value.toLowerCase());

    for (const invocation of invocations) {
        if (/\$|`/u.test(invocation[0])) {
            throw new Error("SHELL_POLICY_WSL_INTERPOLATION_DENIED");
        }
        const tokens = tokenizeWslCommand(command);
        const unquote = value => value ?? "";
        const execIndex = tokens.findIndex(value => value === "--exec" || value === "-e");
        if (execIndex < 0) {
            if (/^wsl(?:\.exe)?\s+(?:-l|--list|--status|--version)\s*$/iu.test(invocation[0])) continue;
            throw new Error("SHELL_POLICY_NESTED_SHELL_DENIED");
        }
        const options = tokens.slice(1, execIndex).map(unquote);
        if (options.some(value => value === "-u" || value === "--user" ||
            value.startsWith("--user="))) {
            throw new Error("SHELL_POLICY_WSL_USER_OVERRIDE_DENIED");
        }
        for (let i = 0; i < options.length; i++) {
            if ((options[i] === "--cd" || options[i] === "-C") &&
                (!options[i + 1] || options[i + 1] === "~" ||
                    options[i + 1].startsWith("~/"))) {
                throw new Error("SHELL_POLICY_WSL_CWD_UNVERIFIED");
            }
            if (options[i] === "--cd=~" || options[i].startsWith("--cd=~/")) {
                throw new Error("SHELL_POLICY_WSL_CWD_UNVERIFIED");
            }
        }
        const executable = unquote(tokens[execIndex + 1]);
        if (!executable || /(?:^|\/)(?:bash|sh|dash|zsh|fish|pwsh|powershell|cmd)(?:\.exe)?$/iu.test(executable)) {
            throw new Error("SHELL_POLICY_NESTED_SHELL_DENIED");
        }
        const argumentsToCheck = [
            ...tokens.slice(1, execIndex),
            ...tokens.slice(execIndex + 2),
        ];
        for (let i = 0; i < argumentsToCheck.length; i++) {
            const token = unquote(argumentsToCheck[i]);
            const path = token.includes("=") ? token.slice(token.indexOf("=") + 1) : token;
            if (!path.startsWith("/")) continue;
            const normalized = posix.normalize(path);
            const casefold = normalized.toLowerCase();
            const root = allowed.find(value => casefold === value || casefold.startsWith(value + "/"));
            if (!root) throw new Error(`SHELL_POLICY_WSL_PATH_OUTSIDE_PROJECT: ${path}`);
            const windowsPath = normalized.replace(/^\/mnt\/([a-z])\//iu, (_, drive) => drive.toUpperCase() + ":/").replaceAll("/", "\\");
            // Reuse the canonical Project realpath check: Windows junctions or
            // WSL DrvFS links cannot silently escape the registered root.
            await assertRealPathAllowed(project, windowsPath, true);
        }
    }
}

export async function validateProjectShellCommand(project, command) {
    const normalized = String(command ?? "").trim();
    if (!normalized)
        throw new Error("COMMAND_REQUIRED");
    if (normalized.length > 12000)
        throw new Error("COMMAND_TOO_LARGE");
    if (normalized.includes("\0"))
        throw new Error("COMMAND_INVALID");

    if (/(?:^|[\\/\s"'`=;|&()])\.\.(?:[\\/]|(?=\s|$|["']))/u.test(normalized)) {
        throw new Error("SHELL_POLICY_PARENT_TRAVERSAL_DENIED");
    }
    if (/\$(?:env:)?(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH)\b|%(?:USERPROFILE|HOMEDRIVE|HOMEPATH)%|(?:^|\s)~[\\/]/iu.test(normalized)) {
        throw new Error("SHELL_POLICY_EXTERNAL_HOME_EXPANSION_DENIED");
    }
    // Match a real command-interpreter invocation, not flags passed to
    // applications launched by WSL (git -c, gcc -c, etc.).
    // WSL itself remains disallowed in command-string mode.
    if (/\b(?:powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|bash(?:\.exe)?|sh)\b[^\r\n]*(?:-command|-c|\/c)\b/iu.test(normalized) ||
        /\bwsl(?:\.exe)?\b\s+(?:(?:-d|--distribution|-u|--user)\s+\S+\s+)*(?:-command|-c|\/c)\b/iu.test(normalized)) {
        throw new Error("SHELL_POLICY_NESTED_SHELL_DENIED");
    }
    if (/\b(?:node(?:\.exe)?\s+(?:--eval|-e)|python(?:3)?(?:\.exe)?\s+-c|ruby(?:\.exe)?\s+-e|perl(?:\.exe)?\s+-e)\b/iu.test(normalized)) {
        throw new Error("SHELL_POLICY_INLINE_INTERPRETER_DENIED");
    }

    await validateWslProjectArguments(project, normalized);
    for (const candidate of collectAbsolutePathCandidates(normalized)) {
        const target = resolve(candidate);
        if (!projectRoots(project).some((root) => isWithin(root, target))) {
            throw new Error(`SHELL_POLICY_PATH_OUTSIDE_PROJECT: ${candidate}`);
        }
        await assertRealPathAllowed(project, target, true);
    }

    return normalized;
}

export function isProjectToolName(toolName) {
    return PROJECT_TOOL_NAMES.has(toolName);
}

export function projectToolDefinitions(project) {
    const tools = [];
    if (project.permissions?.read) {
        tools.push({
            name: "openchatx_read_file",
            label: "OpenChatX Read File",
            description: "Read a UTF-8 text file through the OpenChatX Project permission boundary. Paths must remain inside the registered Project.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    max_chars: { type: "integer", minimum: 1, maximum: 50000 },
                },
                required: ["path"],
                additionalProperties: false,
            },
            timeout_ms: 30000,
            auto_background: false,
        });
    }
    if (project.permissions?.write) {
        tools.push({
            name: "openchatx_write_file",
            label: "OpenChatX Write File",
            description: "Create, overwrite, or append a UTF-8 text file through the OpenChatX Project permission boundary. Paths must remain inside the registered Project.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                    mode: { type: "string", enum: ["overwrite", "append"] },
                },
                required: ["path", "content"],
                additionalProperties: false,
            },
            timeout_ms: 30000,
            auto_background: false,
        });
    }
    if (project.permissions?.shell) {
        tools.push({
            name: "openchatx_shell",
            label: "OpenChatX Shell",
            description: "Run a non-interactive shell command through the OpenChatX Project shell boundary. The working directory and explicit path references must remain inside the registered Project; parent traversal, external home expansion, nested shells, and inline interpreter escape hatches are denied.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string" },
                    cwd: { type: "string" },
                    timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 },
                },
                required: ["command"],
                additionalProperties: false,
            },
            timeout_ms: 65000,
            auto_background: false,
        });
    }
    return tools;
}

export async function decideProjectToolApproval(project, toolName, input) {
    try {
        if (toolName === "openchatx_read_file") {
            requirePermission(project, "read");
            const target = resolveProjectPath(project, String(input.path ?? ""));
            await assertRealPathAllowed(project, target, false);
        }
        else if (toolName === "openchatx_write_file") {
            requirePermission(project, "write");
            const content = String(input.content ?? "");
            if (content.length > 200000)
                throw new Error("WRITE_CONTENT_TOO_LARGE");
            const target = resolveProjectPath(project, String(input.path ?? ""));
            await assertRealPathAllowed(project, target, true);
        }
        else if (toolName === "openchatx_shell") {
            requirePermission(project, "shell");
            await validateProjectShellCommand(project, input.command);
            const cwd = resolveProjectPath(project, String(input.cwd ?? "."));
            const actualCwd = await assertRealPathAllowed(project, cwd, false);
            const info = await fs.stat(actualCwd);
            if (!info.isDirectory())
                throw new Error("CWD_NOT_DIRECTORY");
        }
        else {
            throw new Error(`EXTERNAL_TOOL_UNKNOWN: ${toolName}`);
        }
        return {
            behavior: "allow",
            message: `Approved by canonical OpenChatX ProjectExecutor for ${project.id}`,
            updated_input: null,
            selected_permission_suggestion_ids: [],
        };
    }
    catch (error) {
        return {
            behavior: "deny",
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function executeProjectTool(project, toolName, input) {
    try {
        if (toolName === "openchatx_read_file") {
            requirePermission(project, "read");
            const requested = String(input.path ?? "");
            const target = resolveProjectPath(project, requested);
            const actual = await assertRealPathAllowed(project, target, false);
            const info = await fs.stat(actual);
            if (!info.isFile())
                throw new Error(`NOT_A_FILE: ${requested}`);
            const requestedLimit = Number(input.max_chars ?? 20000);
            const maxChars = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50000) : 20000;
            // At most four UTF-8 bytes per character, plus lookahead. Bound the
            // actual allocation/read rather than loading a whole large file.
            const handle = await fs.open(actual, "r");
            let clipped;
            try {
                if (!(await handle.stat()).isFile()) throw new Error(`NOT_A_FILE: ${requested}`);
                const buffer = Buffer.alloc((maxChars + 1) * 4);
                let length = 0;
                while (length < buffer.length) {
                    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
                    if (!bytesRead) break;
                    length += bytesRead;
                }
                clipped = truncate(buffer.subarray(0, length).toString("utf8"), maxChars);
                clipped.truncated ||= length === buffer.length;
            } finally { await handle.close(); }
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ path: requested, content: clipped.text, truncated: clipped.truncated }, null, 2),
                }],
            };
        }
        if (toolName === "openchatx_write_file") {
            requirePermission(project, "write");
            const requested = String(input.path ?? "");
            const content = String(input.content ?? "");
            if (content.length > 200000)
                throw new Error("WRITE_CONTENT_TOO_LARGE");
            const target = resolveProjectPath(project, requested);
            const actual = await assertRealPathAllowed(project, target, true);
            const mode = input.mode === "append" ? "append" : "overwrite";
            if (mode === "append")
                await fs.appendFile(actual, content, "utf8");
            else
                await fs.writeFile(actual, content, "utf8");
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ path: requested, mode, chars_written: content.length }, null, 2),
                }],
            };
        }
        if (toolName === "openchatx_shell") {
            requirePermission(project, "shell");
            const command = await validateProjectShellCommand(project, input.command);
            const requestedCwd = String(input.cwd ?? ".");
            const targetCwd = resolveProjectPath(project, requestedCwd);
            const actualCwd = await assertRealPathAllowed(project, targetCwd, false);
            const info = await fs.stat(actualCwd);
            if (!info.isDirectory())
                throw new Error(`CWD_NOT_DIRECTORY: ${requestedCwd}`);
            const timeout = Math.min(Math.max(Number(input.timeout_ms ?? 30000), 1000), 60000);
            // Execute validated WSL argv directly. Do not reinterpret it via
            // PowerShell (which can change quoting and command boundaries).
            const directWsl = process.platform === "win32" &&
                /^wsl(?:\.exe)?\s/iu.test(command);
            const executable = directWsl ? "wsl.exe" :
                process.platform === "win32" ? MCP_CONFIG.shell.path : "/bin/sh";
            const args = directWsl
                ? tokenizeWslCommand(command).slice(1)
                : process.platform === "win32"
                    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
                    : ["-lc", command];
            try {
                const result = await execFileAsync(executable, args, {
                    cwd: actualCwd,
                    windowsHide: true,
                    timeout,
                    maxBuffer: 2 * 1024 * 1024,
                    encoding: "utf8",
                });
                const stdout = truncate(result.stdout ?? "", 20000);
                const stderr = truncate(result.stderr ?? "", 8000);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            cwd: requestedCwd,
                            exit_code: 0,
                            stdout: stdout.text,
                            stderr: stderr.text,
                            output_truncated: stdout.truncated || stderr.truncated,
                            shell_policy_version: SHELL_POLICY_VERSION,
                            ...(directWsl ? { execution_mode: "wsl_exec" } : {}),
                        }, null, 2),
                    }],
                };
            }
            catch (error) {
                const failure = error;
                return {
                    is_error: true,
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            cwd: requestedCwd,
                            exit_code: failure.code ?? null,
                            error: failure.message,
                            stdout: truncate(failure.stdout ?? "", 12000).text,
                            stderr: truncate(failure.stderr ?? "", 8000).text,
                            shell_policy_version: SHELL_POLICY_VERSION,
                            ...(directWsl ? { execution_mode: "wsl_exec" } : {}),
                        }, null, 2),
                    }],
                };
            }
        }
        throw new Error(`EXTERNAL_TOOL_UNKNOWN: ${toolName}`);
    }
    catch (error) {
        return {
            is_error: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
    }
}
