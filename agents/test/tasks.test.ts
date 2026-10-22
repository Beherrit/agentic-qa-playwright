import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LayersSchema, type Layer } from '../lib/layers.ts';
import type { TestCase } from '../lib/schemas.ts';
import { fingerprintIn, layerLabel, planSync, syncMd, TASK_LABEL, taskFingerprint, tasksFor } from '../lib/tasks.ts';
import type { ChildTask } from '../sources/types.ts';

const LAYERS: Layer[] = LayersSchema.parse([
  { id: 'component', name: 'Component tests', kind: 'lower', proves: 'Rendering and form rules.', tools: 'Vitest', owner: 'Frontend' },
  { id: 'browser', name: 'Browser suite', kind: 'e2e', proves: 'Journeys across pages.', tools: 'Playwright', owner: 'QA' },
  { id: 'manual', name: 'Manual', kind: 'manual', proves: 'Judgement.', owner: 'QA' },
]);

const tc = (id: string, layer: string, title = `Case ${id}`): TestCase => ({
  id,
  title,
  criteria: ['AC-1'],
  technique: 'boundary-values',
  layer,
  layerReason: 'cheapest place',
  priority: 'P1',
  persona: 'standard_user',
  steps: ['Open the cart', 'Remove the item'],
  expected: 'The badge is gone',
});

const REQUEST = { key: 'SHOP-3', ref: 'SHOP-3', source: 'jira' as const, title: 'Remove from cart' };
const STRATEGY = { cases: [tc('TC-1', 'browser'), tc('TC-2', 'component'), tc('TC-3', 'browser'), tc('TC-4', 'manual')] };

const child = (ref: string, layer: string, body: string): ChildTask => ({ ref, title: 't', body, labels: [TASK_LABEL, layerLabel(layer)], url: null });

describe('per-layer tasks', () => {
  it('makes one task per layer that has cases, in the project\'s order, with each case as a checklist item', () => {
    const tasks = tasksFor(REQUEST, STRATEGY, LAYERS);
    assert.deepEqual(
      tasks.map((t) => [t.layer.id, t.cases]),
      [
        ['component', 1],
        ['browser', 2],
        ['manual', 1],
      ],
    );
    const browser = tasks[1];
    assert.equal(browser.title, '[QA] Browser suite for SHOP-3: Remove from cart');
    assert.deepEqual(browser.labels, ['qa-task', 'qa-layer-browser']);
    assert.match(browser.body, /^Part of SHOP-3\n/);
    assert.match(browser.body, /- \[ \] \*\*TC-1\*\* Case TC-1 \(AC-1\)\. P1, boundary-values, as standard_user\.\n {3}1\. Open the cart\n {3}2\. Remove the item\n {3}Expected: The badge is gone/);
    assert.match(browser.body, /qa-generate/);
    assert.doesNotMatch(tasks[0].body, /qa-generate/);
    assert.equal(fingerprintIn(browser.body), browser.fingerprint);
  });

  it('points a GitHub task at its issue by number, so it can be found without sub-issues', () => {
    const [task] = tasksFor({ ...REQUEST, source: 'github', ref: '12' }, STRATEGY, LAYERS, ['component']);
    assert.match(task.body, /^Part of #12\n/);
  });

  it('can be limited to some layers', () => {
    assert.deepEqual(
      tasksFor(REQUEST, STRATEGY, LAYERS, ['manual']).map((t) => t.layer.id),
      ['manual'],
    );
  });

  it('fingerprints what a task says, so only a real change rewrites it', () => {
    const before = taskFingerprint(LAYERS[1], [tc('TC-1', 'browser')]);
    assert.equal(taskFingerprint(LAYERS[1], [tc('TC-1', 'browser')]), before);
    assert.notEqual(taskFingerprint(LAYERS[1], [tc('TC-1', 'browser', 'Reworded')]), before);
    assert.notEqual(taskFingerprint({ ...LAYERS[1], owner: 'Someone else' }, [tc('TC-1', 'browser')]), before);
    assert.equal(fingerprintIn('A task somebody wrote by hand'), null);
  });

  it('files what is missing, rewrites what changed, leaves the rest, and never closes anything', () => {
    const wanted = tasksFor(REQUEST, STRATEGY, LAYERS);
    const existing = [
      child('SHOP-10', 'component', `Old\n\nPlan fingerprint: ${wanted[0].fingerprint}.`),
      child('SHOP-11', 'browser', 'Plan fingerprint: 000000000000.'),
      child('SHOP-12', 'service', 'A layer the plan no longer uses'),
      { ref: 'SHOP-13', title: 'Unrelated', body: '', labels: ['other'], url: null },
    ];
    const plan = planSync(wanted, existing);
    assert.deepEqual(
      plan.create.map((t) => t.layer.id),
      ['manual'],
    );
    assert.deepEqual(
      plan.update.map((u) => [u.ref, u.task.layer.id]),
      [['SHOP-11', 'browser']],
    );
    assert.deepEqual(
      plan.unchanged.map((u) => u.ref),
      ['SHOP-10'],
    );
    assert.deepEqual(
      plan.stale.map((s) => s.ref),
      ['SHOP-12'],
    );
    const md = syncMd(REQUEST, plan, [], true);
    assert.match(md, /dry run/);
    assert.match(md, /Would file Manual: 1 case\(s\)/);
    assert.match(md, /Would update SHOP-11 \(Browser suite\)/);
    assert.match(md, /SHOP-12 "t" has no cases in the plan any more; left open/);
  });

  it('never matches one existing task to two layers', () => {
    const wanted = tasksFor(REQUEST, STRATEGY, LAYERS);
    const plan = planSync(wanted, [child('SHOP-10', 'browser', '')]);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.create.length, 2);
  });
});
