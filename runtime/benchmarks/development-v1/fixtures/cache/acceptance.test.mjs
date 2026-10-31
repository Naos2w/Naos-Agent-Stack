import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncCache } from './src/cache.mjs';
test('concurrent requests and successful results share the cached work', async () => {
  let calls = 0, release;
  const cached = createAsyncCache(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = cached('a'), second = cached('a');
  await Promise.resolve();
  assert.equal(calls, 1);
  release(0);
  assert.deepEqual(await Promise.all([first, second]), [0, 0]);
  assert.equal(await cached('a'), 0);
  assert.equal(calls, 1);
});
test('asynchronous failure is retryable without removing other keys', async () => {
  const counts = new Map();
  const cached = createAsyncCache(async key => {
    counts.set(key, (counts.get(key) || 0) + 1);
    if (key === 'a' && counts.get(key) === 1) throw Error('temporary');
    return key;
  });
  assert.equal(await cached('b'), 'b');
  await assert.rejects(cached('a'), /temporary/);
  const [a1, a2] = await Promise.all([cached('a'), cached('a')]);
  assert.deepEqual([a1, a2], ['a', 'a']);
  assert.equal(await cached('b'), 'b');
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
});
test('synchronous loader failure rejects and is retryable', async () => {
  let calls = 0;
  const cached = createAsyncCache(() => { if (++calls === 1) throw Error('sync'); return 7; });
  await assert.rejects(cached('a'), /sync/);
  assert.equal(await cached('a'), 7);
});
