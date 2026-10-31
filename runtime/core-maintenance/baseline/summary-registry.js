import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MCP_CONFIG } from "../config.js";
const HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const summarySchema = z.object({
    uuid: z.uuid(), content: z.string().min(1), recentContext: z.string().default(""),
    createdAt: z.string(), updatedAt: z.string(), expiresAt: z.string().datetime().optional(),
});
const acknowledgmentSchema = z.object({
    uuid: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime(),
});
const stateSchema = z.object({
    summaries: z.array(summarySchema).default([]),
    acknowledgments: z.array(acknowledgmentSchema).default([]),
});
export class SummaryRegistry {
    statePath;
    summaries = new Map();
    acknowledgments = new Map();
    loadPromise;
    mutationQueue = Promise.resolve();
    constructor(statePath = join(MCP_CONFIG.stateDir, "summaries.json")) {
        this.statePath = statePath;
    }
    async list() {
        await this.mutationQueue;
        await this.ensureLoaded();
        return [...this.summaries.values()].filter(summary => !expired(summary))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(cloneSummary);
    }
    async create(content, recentContext = "") {
        return this.mutate((summaries) => {
            const now = new Date().toISOString();
            const summary = summarySchema.parse({
                uuid: randomUUID(), content: normalizeContent(content), recentContext: recentContext.trim(),
                createdAt: now, updatedAt: now, expiresAt: expiresAt(),
            });
            summaries.set(summary.uuid, summary);
            return cloneSummary(summary);
        });
    }
    async get(uuid) {
        await this.mutationQueue;
        await this.ensureLoaded();
        const summary = this.summaries.get(normalizeUuid(uuid));
        if (!summary) throw new Error("SUMMARY_NOT_FOUND");
        if (expired(summary)) throw new Error("SUMMARY_EXPIRED");
        return cloneSummary(summary);
    }
    async update(uuid, content, recentContext = "") {
        return this.mutate((summaries) => {
            const id = normalizeUuid(uuid), existing = summaries.get(id);
            if (!existing) throw new Error("SUMMARY_NOT_FOUND");
            const summary = summarySchema.parse({ ...existing,
                content: normalizeContent(content), recentContext: recentContext.trim(),
                updatedAt: new Date().toISOString(), expiresAt: expiresAt(),
            });
            summaries.set(id, summary);
            return cloneSummary(summary);
        });
    }
    async remove(uuid) {
        return this.mutate((summaries) => {
            if (!summaries.delete(normalizeUuid(uuid))) throw new Error("SUMMARY_NOT_FOUND");
        });
    }
    // Backward-compatible callers can retry retrieval. Deletion requires an
    // explicit acknowledgment of the exact version the receiver captured.
    async consume(uuid) { return this.get(uuid); }
    async acknowledge(uuid, revision) {
        const id = normalizeUuid(uuid);
        if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
            throw new Error("SUMMARY_REVISION_INVALID");
        return this.mutate((summaries, acknowledgments) => {
            const summary = summaries.get(id);
            if (!summary) {
                if (acknowledgments.get(id)?.revision === revision)
                    return { uuid: id, acknowledged: true, alreadyAcknowledged: true };
                throw new Error("SUMMARY_NOT_FOUND");
            }
            if (summaryRevision(summary) !== revision) throw new Error("SUMMARY_REVISION_MISMATCH");
            summaries.delete(id);
            acknowledgments.set(id, { uuid: id, revision, expiresAt: expiresAt() });
            return { uuid: id, acknowledged: true, alreadyAcknowledged: false };
        });
    }
    async ensureLoaded() {
        this.loadPromise ??= this.load();
        await this.loadPromise;
    }
    async load() {
        try {
            const state = stateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8")));
            for (const summary of state.summaries) this.summaries.set(summary.uuid, summary);
            for (const acknowledgment of state.acknowledgments) this.acknowledgments.set(acknowledgment.uuid, acknowledgment);
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
    }
    mutate(change) {
        const operation = this.mutationQueue.then(async () => {
            await this.ensureLoaded();
            const summaries = new Map([...this.summaries].filter(([, value]) => !expired(value)));
            const acknowledgments = new Map([...this.acknowledgments].filter(([, value]) => !expired(value)));
            const result = change(summaries, acknowledgments);
            await this.persist(summaries, acknowledgments);
            // Publish in-memory state only after atomic file replacement succeeds.
            this.summaries = summaries;
            this.acknowledgments = acknowledgments;
            return result;
        });
        this.mutationQueue = operation.catch(() => {});
        return operation;
    }
    async persist(summaries = this.summaries, acknowledgments = this.acknowledgments) {
        await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
        const temporary = `${this.statePath}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify({ summaries: [...summaries.values()], acknowledgments: [...acknowledgments.values()] }, null, 2)}\n`,
                { encoding: "utf8", mode: 0o600, flag: "wx" });
            await rename(temporary, this.statePath);
        } finally {
            await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
    }
}
function expiresAt() { return new Date(Date.now() + HANDOFF_TTL_MS).toISOString(); }
function expired(value) { return value.expiresAt !== undefined && Date.parse(value.expiresAt) <= Date.now(); }
function normalizeContent(content) {
    const text = content.trim();
    if (!text) throw new Error("Summary content is required.");
    return text;
}
function normalizeUuid(uuid) { return z.uuid().parse(uuid.trim()); }
function summaryRevision(summary) {
    return createHash("sha256").update(JSON.stringify([summary.uuid, summary.content, summary.recentContext, summary.updatedAt])).digest("hex");
}
function cloneSummary(summary) { return { ...summary, revision: summaryRevision(summary) }; }
