import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FILES, initProject, nextSteps } from '../init.ts';
import { ConfigSchema } from '../lib/paths.ts';
import { PKG_ROOT } from '../lib/pkg.ts';

describe('init', () => {
  it('writes every file once, keeps what exists, and overwrites with --force', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-init-'));
    const first = initProject(root);
    assert.deepEqual(first.written, FILES.map((f) => f.to));
    assert.deepEqual(first.kept, []);
    for (const file of FILES) assert.ok(fs.existsSync(path.join(root, file.to)), file.to);

    fs.writeFileSync(path.join(root, 'qa.config.json'), '{"mine": true}');
    const second = initProject(root);
    assert.deepEqual(second.written, []);
    assert.equal(fs.readFileSync(path.join(root, 'qa.config.json'), 'utf8'), '{"mine": true}');

    const third = initProject(root, { force: true });
    assert.equal(third.written.length, FILES.length);
    assert.match(nextSteps(third), /wrote {2}qa\.config\.json[\s\S]*npx agentic-qa survey/);
  });

  it('writes a config the schema accepts, and callers that use the engine workflows', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-init-'));
    initProject(root);
    const config = ConfigSchema.parse(JSON.parse(fs.readFileSync(path.join(root, 'qa.config.json'), 'utf8')));
    assert.equal(config.suite.commands.test, 'npx playwright test');
    for (const name of ['qa-analysis', 'qa-tests', 'regression', 'qa-history']) {
      const text = fs.readFileSync(path.join(root, '.github', 'workflows', `${name}.yml`), 'utf8');
      assert.match(text, new RegExp(`uses: Beherrit/agentic-qa-playwright/\\.github/workflows/${name}\\.yml@`), name);
      assert.match(text, /secrets: inherit|permissions:/, name);
    }
    assert.match(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'), /"agentic-qa"/);
  });

  it('refuses to run inside the engine itself', () => {
    assert.throws(() => initProject(PKG_ROOT), /engine itself/);
  });
});
