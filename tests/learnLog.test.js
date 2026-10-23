import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { LearnLog, NO_CONTEXT } from '../src/learn/log.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let store, log;
const search = (changes = {}) => ({
  id: randomUUID(),
  ctx: NO_CONTEXT,
  tool: 'semantic-search',
  query: 'alpha',
  embedding: [1, 0],
  params: {},
  ranker: 'test',
  results: [],
  ...changes,
});
beforeEach(() => {
  store = Object.fromEntries(
    ['insertSearchLog', 'insertNoteReads', 'insertFeedback', 'upsertSession', 'closeSession'].map(
      k => [k, vi.fn(async () => {})]
    )
  );
  store.searchLogExists = vi.fn(async () => true);
  log = new LearnLog(store, {
    enabled: true,
    patterns: [/zzredactme/i],
    retentionDays: 30,
    error: null,
  });
});
afterEach(() => vi.restoreAllMocks());
describe('LearnLog', () => {
  it('returns before a search write resolves and flush awaits it', async () => {
    const d = deferred();
    store.insertSearchLog.mockReturnValue(d.promise);
    expect(log.logSearch(search())).toBeUndefined();
    let flushed = false;
    const flush = (async () => {
      await log.flush();
      flushed = true;
    })();
    await Promise.resolve();
    expect(flushed).toBe(false);
    d.resolve();
    await flush;
    expect(flushed).toBe(true);
  });
  it('prints failed writes without rejecting', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.insertSearchLog.mockRejectedValue(new Error('database down'));
    expect(() => log.logSearch(search())).not.toThrow();
    await log.flush();
    expect(spy).toHaveBeenCalledWith('learn-log: database down');
  });
  it('redacts query and embedding, strings nested in params and tags, omits absent params', async () => {
    log.logSearch(
      search({
        query: 'alpha zzredactme',
        params: { directory: 'zzredactme', tags: ['normal', 'zzredactme'], k: undefined },
      })
    );
    await log.flush();
    expect(store.insertSearchLog.mock.calls[0][0]).toMatchObject({
      query: null,
      embedding: null,
      redacted: true,
      params: { directory: '[redacted]', tags: ['normal', '[redacted]'] },
    });
    expect(store.insertSearchLog.mock.calls[0][0].params).not.toHaveProperty('k');
  });
  it('waits for the pending search before inserting normalised reads', async () => {
    const d = deferred(),
      order = [],
      entry = search();
    store.insertSearchLog.mockImplementation(async () => {
      await d.promise;
      order.push('search');
    });
    store.insertNoteReads.mockImplementation(async () => {
      order.push('read');
    });
    log.logSearch(entry);
    log.logReads(NO_CONTEXT, 'read-note', ['/notes/alpha'], entry.id);
    expect(store.insertNoteReads).not.toHaveBeenCalled();
    d.resolve();
    await log.flush();
    expect(order).toEqual(['search', 'read']);
    expect(store.insertNoteReads).toHaveBeenCalledWith([
      { ...NO_CONTEXT, tool: 'read-note', path: 'notes/alpha.md', requestId: entry.id },
    ]);
  });
  it('drops sensitive paths and does nothing for an empty list', async () => {
    log.logReads(NO_CONTEXT, 'read-note', ['notes/zzredactme'], null);
    log.logReads(NO_CONTEXT, 'read-note', [], null);
    await log.flush();
    expect(store.insertNoteReads).not.toHaveBeenCalled();
  });
  it('records sessions without blocking and flush waits for both', async () => {
    log.sessionStarted('session', { name: 'client', version: '1' });
    log.sessionClosed('session');
    await log.flush();
    expect(store.upsertSession).toHaveBeenCalledWith({
      sessionId: 'session',
      clientName: 'client',
      clientVersion: '1',
    });
    expect(store.closeSession).toHaveBeenCalledWith('session');
  });
  it.each([{}, { requestId: 'bad' }, { requestId: null }])(
    'rejects unknown ids without querying',
    async input => {
      expect(await log.recordFeedback(input)).toEqual({
        recorded: false,
        reason: 'unknown requestId',
      });
      expect(store.searchLogExists).not.toHaveBeenCalled();
    }
  );
  it.each([
    [{ rating: 'bad' }, 'Invalid rating: expected positive, negative or neutral'],
    [{ source: 'bad' }, 'Invalid source: expected agent or user'],
    [{ usedPaths: 'notes/a.md' }, 'Invalid usedPaths: expected an array of strings'],
    [{ usedPaths: [1] }, 'Invalid usedPaths: expected an array of strings'],
    [{ expectedPaths: null }, 'Invalid expectedPaths: expected an array of strings'],
    [{ expectedPaths: [false] }, 'Invalid expectedPaths: expected an array of strings'],
  ])('validates feedback fields: %j', async (input, message) => {
    await expect(
      log.recordFeedback({ requestId: randomUUID(), rating: 'positive', ...input })
    ).rejects.toThrow(message);
    expect(store.searchLogExists).not.toHaveBeenCalled();
  });
  it('returns unknown for an absent canonical id', async () => {
    store.searchLogExists.mockResolvedValue(false);
    expect(await log.recordFeedback({ requestId: randomUUID(), rating: 'neutral' })).toEqual({
      recorded: false,
      reason: 'unknown requestId',
    });
    expect(store.insertFeedback).not.toHaveBeenCalled();
  });
  it('waits for a pending search before feedback lookup and redacts notes and paths', async () => {
    const d = deferred(),
      entry = search();
    store.insertSearchLog.mockReturnValue(d.promise);
    log.logSearch(entry);
    const feedback = log.recordFeedback({
      requestId: entry.id,
      rating: 'negative',
      note: 'zzredactme',
      usedPaths: ['/notes/alpha', 'notes/zzredactme'],
      expectedPaths: ['notes/zzredactme'],
    });
    expect(store.searchLogExists).not.toHaveBeenCalled();
    d.resolve();
    expect(await feedback).toEqual({ recorded: true });
    expect(store.insertFeedback).toHaveBeenCalledWith({
      searchId: entry.id,
      source: 'agent',
      rating: 'negative',
      note: null,
      redacted: true,
      usedPaths: ['notes/alpha.md'],
      expectedPaths: [],
    });
  });
});
