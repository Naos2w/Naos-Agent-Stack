import test from 'node:test';
import assert from 'node:assert/strict';
import { sumInclusive } from './src/range.mjs';
test('both integer endpoints are included', () => {
  assert.equal(sumInclusive(2, 4), 9);
  assert.equal(sumInclusive(5, 5), 5);
  assert.equal(sumInclusive(-3, -1), -6);
  assert.equal(sumInclusive(-2, 2), 0);
});
test('invalid or reversed bounds throw RangeError', () => {
  for (const bounds of [[3, 2], [0.5, 2], [0, 1.5], [NaN, 2], [1, Infinity], ['1', 2]]) {
    assert.throws(() => sumInclusive(...bounds), RangeError);
  }
});
