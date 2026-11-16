import test from 'node:test';
import assert from 'node:assert/strict';
import { overlapSeconds, synchronizedTimes } from '../lib/seminar-timing.ts';
test('positive offset trims the shared tail', () => {
  assert.deepEqual(overlapSeconds(10,12,3),[0,9]);
  assert.deepEqual(synchronizedTimes(4,3,[0,9]),[4,7]);
});
test('negative offset excludes the unavailable speaker head', () => {
  assert.deepEqual(overlapSeconds(10,12,-3),[3,10]);
  assert.deepEqual(synchronizedTimes(0,-3,[3,10]),[3,0]);
});
test('no overlap and non-finite metadata are rejected', () => {
  assert.equal(overlapSeconds(10,12,12),null);
  assert.equal(overlapSeconds(NaN,12,0),null);
});
test('evidence seek clamps to the valid shared range', () => {
  assert.deepEqual(synchronizedTimes(99,3,[0,9]),[9,12]);
});
