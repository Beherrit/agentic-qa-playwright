import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keyFor, validateRef } from '../lib/keys.ts';
import { MAX_DIFF, previewUrl, pullBody } from '../sources/pull.ts';

describe('a pull request as a requirement', () => {
  it('gets a key, a branch-safe reference and a preview address', () => {
    assert.equal(keyFor('pr', '42'), 'PR-42');
    assert.equal(validateRef('pr', '42'), '42');
    assert.throws(() => validateRef('pr', '42; rm'), /not a valid pr reference/);
    assert.equal(previewUrl('42', 'feature/Reset Cart', 'https://pr-{number}.preview.example/{branch}'), 'https://pr-42.preview.example/feature-reset-cart');
    assert.equal(previewUrl('42', 'x', undefined), undefined);
    assert.equal(previewUrl('42', 'x', 'preview.example/{number}'), undefined, 'a template without a scheme is not an address');
  });

  it('writes the description, the files and the diff into the body, and cuts a huge diff', () => {
    const body = pullBody({
      body: 'Adds reset.',
      headRefName: 'feature/reset',
      baseRefName: 'main',
      files: [{ path: 'src/cart.ts', additions: 10, deletions: 2 }],
      diff: 'x'.repeat(MAX_DIFF + 500),
    });
    assert.match(body, /^Adds reset\./);
    assert.match(body, /Branch `feature\/reset` into `main`\. 1 file\(s\) changed\./);
    assert.match(body, /\| `src\/cart\.ts` \| \+10 \| -2 \|/);
    assert.match(body, /<diff>\nx+\n\n\(cut short: 500 more characters\)\n<\/diff>$/);
    assert.match(pullBody({ body: '', headRefName: 'a', baseRefName: 'b', files: [], diff: '' }), /_The pull request has no description\._/);
  });
});
