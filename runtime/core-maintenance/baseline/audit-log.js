import { appendFileSync, chmodSync, createReadStream, createWriteStream, existsSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { getAgentIdentity } from "../../agent/context.js";
import { countTokens } from "../../tokenizer.js";
import { errorMessage, formatAuditEntry, formatAuditTime, summarizeToolResult, } from "./audit-format.js";
import { createAuditRequest } from "./audit-request.js";
export class McpAuditLogger {
    filePath;
    now;
    clock;
    maxBytes;
    pendingArchives = new Set();
    constructor(filePath, now = () => new Date(), clock = () => Date.now(), maxBytes = 64 * 1024 * 1024) {
        this.filePath = filePath;
        this.now = now;
        this.clock = clock;
        this.maxBytes = maxBytes;
        try {
            if (existsSync(this.filePath))
                chmodSync(this.filePath, 0o600);
        }
        catch (error) {
            console.warn(`Could not secure MCP audit log: ${errorMessage(error)}`);
        }
        // If the process stopped during async compression, the .archive is
        // deliberately retained. Resume that work without losing the audit.
        this.recoverPendingArchives();
    }
    recoverPendingArchives() {
        try {
            const folder = dirname(this.filePath);
            const prefix = basename(this.filePath) + ".";
            for (const name of readdirSync(folder)) {
                const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : "";
                if (/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.[0-9a-f-]{36}\.archive$/u.test(suffix)) {
                    this.scheduleArchive(join(folder, name));
                }
            }
        }
        catch (error) {
            console.warn(`Audit archive recovery deferred: ${errorMessage(error)}`);
        }
    }
    startRequest(payload) {
        return createAuditRequest(payload, (toolName, argumentsValue) => this.startToolCall(toolName, argumentsValue), () => this.appendToolList());
    }
    startToolCall(toolName, argumentsValue) {
        const identity = getAgentIdentity();
        let agentLabel;
        if (identity) {
            agentLabel = identity.taskSlug ? `${identity.agent}/${identity.taskSlug}` : identity.agent;
        }
        const startedAt = this.clock();
        const startedTime = this.now();
        const inputTokens = countTokens(JSON.stringify(argumentsValue ?? {}));
        let finished = false;
        return {
            finish: (input = {}) => {
                if (finished)
                    return;
                finished = true;
                const toolResponse = summarizeToolResult(input.toolResult, input.modelResult ?? input.toolResult, input.error);
                const httpStatus = input.httpStatus ?? 200;
                const state = input.state ?? "finished";
                const exitCode = toolResponse.structuredContent?.exit_code;
                const commandFailed = toolName === "bash" && typeof exitCode === "number" && exitCode !== 0;
                const commandOutput = toolResponse.structuredContent?.output;
                let failureMessage = toolResponse.failureMessage;
                if (!failureMessage && commandFailed) {
                    failureMessage =
                        typeof commandOutput === "string" && commandOutput.trim()
                            ? commandOutput.trim()
                            : `Command exited with code ${exitCode}.`;
                }
                this.append(formatAuditEntry({
                    time: startedTime,
                    toolName,
                    argumentsValue,
                    durationMs: Math.max(0, this.clock() - startedAt),
                    httpStatus,
                    state,
                    inputTokens,
                    outputTokens: toolResponse.modelOutput !== undefined
                        ? countTokens(toolResponse.modelOutput)
                        : undefined,
                    toolFailed: toolResponse.failed || commandFailed,
                    failureMessage,
                    responseSummary: toolResponse,
                    agentLabel,
                }));
            },
        };
    }
    appendToolList() {
        this.append(`--- # tools/list - ${formatAuditTime(this.now())}\n`);
    }
    async compressArchive(archived) {
        const compressed = `${archived}.gz`;
        const temporary = `${compressed}.tmp`;
        const digest = async (stream) => {
            const hash = createHash("sha256");
            for await (const chunk of stream) hash.update(chunk);
            return hash.digest("hex");
        };
        try {
            // After a crash the same archived input is complete, but its
            // former .gz.tmp may be incomplete. Discard only that temporary
            // file; keep the original .archive until verification succeeds.
            if (existsSync(temporary)) unlinkSync(temporary);
            // Stream compression and verification away from the MCP request
            // path. A crash leaves the complete .archive for manual recovery.
            await pipeline(
                createReadStream(archived),
                createGzip({ level: 1 }),
                createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
            );
            const originalHash = await digest(createReadStream(archived));
            const restoredHash = await digest(createReadStream(temporary).pipe(createGunzip()));
            if (originalHash !== restoredHash) {
                throw new Error("AUDIT_ARCHIVE_VERIFICATION_FAILED");
            }
            renameSync(temporary, compressed);
            chmodSync(compressed, 0o600);
            unlinkSync(archived);
        }
        catch (error) {
            try { if (existsSync(temporary)) unlinkSync(temporary); } catch {}
            console.warn(`Audit log retained as raw archive: ${errorMessage(error)}`);
        }
    }
    rotateIfNeeded(nextBytes) {
        if (!existsSync(this.filePath) ||
            statSync(this.filePath).size + nextBytes < this.maxBytes) return;
        // Rename is atomic on the same volume; the active audit file is
        // recreated by append(), regardless of archive-compression progress.
        const suffix = this.now().toISOString().replace(/[:.]/g, "-");
        const archived = `${this.filePath}.${suffix}.${randomUUID()}.archive`;
        renameSync(this.filePath, archived);
        this.scheduleArchive(archived);
    }
    scheduleArchive(archived) {
        const pending = this.compressArchive(archived);
        this.pendingArchives.add(pending);
        void pending.finally(() => this.pendingArchives.delete(pending));
    }
    async waitForArchives() {
        await Promise.all([...this.pendingArchives]);
    }
    append(entry) {
        try {
            this.rotateIfNeeded(Buffer.byteLength(entry, "utf8"));
        }
        catch (error) {
            // A failed rotation must not silently drop the new audit entry.
            console.warn(`Could not rotate MCP audit log: ${errorMessage(error)}`);
        }
        try {
            appendFileSync(this.filePath, entry, { encoding: "utf8", mode: 0o600 });
            chmodSync(this.filePath, 0o600);
        }
        catch (error) {
            console.warn(`Could not update MCP audit log: ${errorMessage(error)}`);
        }
    }
}
