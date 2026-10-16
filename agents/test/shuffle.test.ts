import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playwrightVersion, supportsShuffle } from '../lib/suite.ts';

test('shuffling is only offered to a Playwright that has it', () => {
  assert.equal(supportsShuffle('1.63.0'), false);
  assert.equal(supportsShuffle('1.64.0'), true);
  assert.equal(supportsShuffle('1.70.2'), true);
  assert.equal(supportsShuffle('2.0.0'), true);
  assert.equal(supportsShuffle(null), false);
});

test('the host project version is read from its own node_modules', () => {
  assert.match(playwrightVersion() ?? '', /^\d+\.\d+\.\d+/);
  assert.equal(playwrightVersion('/definitely/not/a/project'), null);
});
