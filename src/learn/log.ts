import { randomUUID } from 'crypto';
import type { IndexStore, SessionTransport } from '../index/store.js';
import type { LearnConfig } from './config.js';
import { isSensitive } from './redact.js';

export interface CallContext {
  sessionId: string | null;
  clientName: string | null;
}
export const NO_CONTEXT: CallContext = { sessionId: null, clientName: null };
export interface FeedbackInput {
  requestId: string;
  rating: 'positive' | 'negative' | 'neutral';
  source?: 'agent' | 'user';
  usedPaths?: string[];
  expectedPaths?: string[];
  note?: string;
}

export function normalisePath(p: string): string {
  const clean = p.replace(/^[/\\]+/, '');
  return clean.endsWith('.md') ? clean : `${clean}.md`;
}

export class LearnLog {
  private inflight = new Set<Promise<void>>();
  private pending = new Map<string, Promise<void>>();

  constructor(
    private store: IndexStore,
    private config: LearnConfig
  ) {}

  newRequestId(): string {
    return randomUUID();
  }

  private track(write: Promise<void>, id?: string): void {
    const p = write.catch(err => console.error('learn-log: ' + err.message));
    this.inflight.add(p);
    if (id) this.pending.set(id, p);
    void this.settled(p, id);
  }

  private async settled(p: Promise<void>, id?: string): Promise<void> {
    await p;
    this.inflight.delete(p);
    if (id) this.pending.delete(id);
  }

  logSearch(entry: {
    id: string;
    ctx: CallContext;
    tool: string;
    query: string;
    embedding: number[] | null;
    params: Record<string, unknown>;
    ranker: string;
    results: unknown[];
  }): void {
    let redacted = isSensitive(entry.query, this.config.patterns);
    const query = redacted ? null : entry.query;
    const embedding = redacted ? null : entry.embedding;
    const redactValue = (value: unknown): unknown => {
      if (typeof value === 'string' && isSensitive(value, this.config.patterns)) {
        redacted = true;
        return '[redacted]';
      }
      if (Array.isArray(value)) return value.map(redactValue);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, redactValue(v)])
        );
      return value;
    };
    const params = redactValue(entry.params) as Record<string, unknown>;
    this.track(
      this.store.insertSearchLog({
        id: entry.id,
        ...entry.ctx,
        tool: entry.tool,
        query,
        redacted,
        embedding,
        params,
        ranker: entry.ranker,
        results: entry.results,
      }),
      entry.id
    );
  }

  logReads(ctx: CallContext, tool: string, paths: string[], requestId: string | null): void {
    const safe = paths.map(normalisePath).filter(p => !isSensitive(p, this.config.patterns));
    if (!safe.length) return;
    const pending = requestId ? this.pending.get(requestId) : undefined;
    const write = async () => {
      if (pending) await pending;
      await this.store.insertNoteReads(safe.map(path => ({ ...ctx, tool, path, requestId })));
    };
    this.track(write());
  }

  async recordFeedback(
    input: unknown
  ): Promise<{ recorded: true } | { recorded: false; reason: string }> {
    const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const requestId = args.requestId;
    if (
      typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
    ) {
      return { recorded: false, reason: 'unknown requestId' };
    }
    const { rating, source } = args;
    if (rating !== 'positive' && rating !== 'negative' && rating !== 'neutral') {
      throw new Error('Invalid rating: expected positive, negative or neutral');
    }
    if (source !== undefined && source !== 'agent' && source !== 'user') {
      throw new Error('Invalid source: expected agent or user');
    }
    for (const key of ['usedPaths', 'expectedPaths']) {
      if (
        args[key] !== undefined &&
        (!Array.isArray(args[key]) || !args[key].every(p => typeof p === 'string'))
      ) {
        throw new Error(`Invalid ${key}: expected an array of strings`);
      }
    }
    await this.pending.get(requestId);
    if (!(await this.store.searchLogExists(requestId)))
      return { recorded: false, reason: 'unknown requestId' };
    let redacted = false;
    const safePaths = (paths: string[]) =>
      paths.map(normalisePath).filter(p => {
        if (!isSensitive(p, this.config.patterns)) return true;
        redacted = true;
        return false;
      });
    const usedPaths = safePaths((args.usedPaths as string[] | undefined) ?? []);
    const expectedPaths = safePaths((args.expectedPaths as string[] | undefined) ?? []);
    let note = typeof args.note === 'string' ? args.note : null;
    if (note !== null && isSensitive(note, this.config.patterns)) {
      note = null;
      redacted = true;
    }
    await this.store.insertFeedback({
      searchId: requestId,
      source: source ?? 'agent',
      rating,
      usedPaths,
      expectedPaths,
      note,
      redacted,
    });
    return { recorded: true };
  }

  sessionStarted(
    sessionId: string,
    client: { name?: string; version?: string } | undefined,
    transport: SessionTransport = 'sse'
  ): void {
    this.track(
      this.store.upsertSession({
        sessionId,
        transport,
        clientName: client?.name ?? null,
        clientVersion: client?.version ?? null,
      }),
      sessionId
    );
  }

  /** Client name of a recorded session; undefined when unknown. Waits for its pending upsert. */
  async sessionClient(sessionId: string): Promise<string | null | undefined> {
    await this.pending.get(sessionId);
    return this.store.sessionClient(sessionId);
  }

  sessionClosed(sessionId: string): void {
    this.track(this.store.closeSession(sessionId));
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }
}
