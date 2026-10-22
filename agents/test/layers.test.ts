import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  checkCoverage,
  countByLayer,
  coverageRoots,
  DEFAULT_LAYERS,
  e2eId,
  isE2e,
  kindOf,
  LayersSchema,
  layersText,
  placeCases,
  splitLayerPath,
  type Layer,
} from '../lib/layers.ts';
import { strategySchemas, Technique } from '../lib/schemas.ts';
import { planHealth } from '../lib/score.ts';

const ROOT = path.resolve('/work/shop-e2e');

/** A team with component tests in the web repo, service tests in the API repo, the browser suite and manual. */
const TEAM: Layer[] = LayersSchema.parse([
  { id: 'component', name: 'Component tests', kind: 'lower', proves: 'Rendering and form rules', tools: 'Vitest', owner: 'Frontend', repo: '../web' },
  { id: 'service', name: 'Service tests', kind: 'lower', proves: 'Business rules with a database', tools: 'JUnit', owner: 'Backend', repo: '../api' },
  { id: 'browser', name: 'Browser suite', kind: 'e2e', proves: 'Journeys across pages', tools: 'Playwright', owner: 'QA' },
  { id: 'exploratory', name: 'Exploratory', kind: 'manual', proves: 'Judgement', owner: 'QA' },
]);

const testCase = (id: string, layer: string, technique = 'boundary-values') => ({ id, layer, technique, criteria: ['AC-1'] });

describe('test layers', () => {
  it('defaults to the three layers the pipeline always had', () => {
    assert.deepEqual(
      DEFAULT_LAYERS.map((l) => [l.id, l.kind]),
      [
        ['lower-layer', 'lower'],
        ['e2e', 'e2e'],
        ['manual', 'manual'],
      ],
    );
    assert.equal(LayersSchema.safeParse(DEFAULT_LAYERS).success, true);
  });

  it('refuses a list without exactly one browser layer, or with a repeated id', () => {
    const noE2e = LayersSchema.safeParse([{ id: 'unit', name: 'Unit', kind: 'lower', proves: 'x' }]);
    assert.equal(noE2e.success, false);
    const twoE2e = LayersSchema.safeParse([
      { id: 'a', name: 'A', kind: 'e2e', proves: 'x' },
      { id: 'b', name: 'B', kind: 'e2e', proves: 'x' },
    ]);
    assert.equal(twoE2e.success, false);
    const repeated = LayersSchema.safeParse([
      { id: 'e2e', name: 'A', kind: 'e2e', proves: 'x' },
      { id: 'e2e', name: 'B', kind: 'manual', proves: 'x' },
    ]);
    assert.equal(repeated.success, false);
    assert.match(String(repeated.error), /unique/);
  });

  it('knows which cases are the browser suite\'s by kind, not by name', () => {
    assert.equal(isE2e(TEAM, { layer: 'browser' }), true);
    assert.equal(isE2e(TEAM, { layer: 'component' }), false);
    assert.equal(e2eId(TEAM), 'browser');
    // An id the project does not list is treated as somebody else's work, not dropped and not automated.
    assert.equal(kindOf(TEAM, 'nonsense'), 'lower');
  });

  it('moves a case on an unknown layer to the nearest fit, keeping what the old ids meant', () => {
    const { cases, moved } = placeCases([testCase('TC-1', 'e2e'), testCase('TC-2', 'manual'), testCase('TC-3', 'lower-layer'), testCase('TC-4', 'browser')], TEAM);
    assert.deepEqual(
      cases.map((c) => c.layer),
      ['browser', 'exploratory', 'component', 'browser'],
    );
    assert.equal(moved.length, 3);
  });

  it('always sends an exploratory charter to a person', () => {
    const { cases, moved } = placeCases([testCase('TC-1', 'browser', 'exploratory-charter')], TEAM);
    assert.equal(cases[0].layer, 'exploratory');
    assert.match(moved[0], /charter/);
  });

  it('reads "<layer>:<path>" as a file in that layer\'s repository', () => {
    assert.deepEqual(splitLayerPath('component:src/cart/Total.test.tsx', TEAM)?.file, 'src/cart/Total.test.tsx');
    assert.equal(splitLayerPath('tests/cart.spec.ts', TEAM), null);
    // A Windows drive letter is not a layer.
    assert.equal(splitLayerPath('C:/tests/cart.spec.ts', TEAM), null);
  });

  it('keeps existing coverage only where the file is there, and trusts nothing outside a repository', () => {
    const present = new Set([path.join(ROOT, 'tests/cart.spec.ts'), path.resolve(ROOT, '../web'), path.join(path.resolve(ROOT, '../web'), 'src/cart/Total.test.tsx')]);
    const exists = (file: string): boolean => present.has(file);
    const { kept, dropped } = checkCoverage(
      [
        { file: 'tests/cart.spec.ts' },
        { file: 'tests/gone.spec.ts' },
        { file: 'component:src/cart/Total.test.tsx' },
        { file: 'component:src/cart/Missing.test.tsx' },
        // The API repository is not checked out here, so its claim cannot be checked and is kept as given.
        { file: 'service:src/test/CartServiceTest.java' },
        { file: '../secrets.txt' },
      ],
      TEAM,
      ROOT,
      exists,
    );
    assert.deepEqual(
      kept.map((k) => k.file),
      ['tests/cart.spec.ts', 'component:src/cart/Total.test.tsx', 'service:src/test/CartServiceTest.java'],
    );
    assert.equal(dropped.length, 3);
  });

  it('gives the agents only the layer repositories that are checked out', () => {
    const roots = coverageRoots(TEAM, ROOT, (dir) => dir === path.resolve(ROOT, '../web'));
    assert.deepEqual(roots, [{ id: 'component', dir: path.resolve(ROOT, '../web') }]);
  });

  it('lists the layers cheapest first, with owners and where to search', () => {
    const text = layersText(TEAM, ROOT, (dir) => dir === path.resolve(ROOT, '../web'));
    assert.match(text, /1\. `component` \(Component tests, lower\)/);
    assert.match(text, /search it before planning/);
    assert.match(text, /\(Its repository, \.\.\/api, is not checked out here\.\)/);
    assert.match(text, /`browser`.*This pipeline writes these\./);
  });

  it('counts cases per layer in the project\'s order', () => {
    const counts = countByLayer([{ layer: 'browser' }, { layer: 'component' }, { layer: 'browser' }], TEAM);
    assert.deepEqual(
      counts.map((c) => [c.layer.id, c.count]),
      [
        ['component', 1],
        ['browser', 2],
      ],
    );
  });

  it('narrows the agents\' schema to the project\'s layer ids', () => {
    const { Plan } = strategySchemas(['component', 'browser']);
    const base = {
      existingCoverage: [],
      siteNotes: '',
      contract: [],
      regressionRisks: [],
      cases: [{ id: 'TC-1', title: 't', criteria: ['AC-1'], technique: 'pairwise', layer: 'browser', layerReason: 'r', priority: 'P1', persona: 'p', steps: ['s'], expected: 'e' }],
    };
    assert.equal(Plan.safeParse(base).success, true);
    assert.equal(Plan.safeParse({ ...base, cases: [{ ...base.cases[0], layer: 'e2e' }] }).success, false);
  });

  it('offers pairwise and exploratory charters as techniques', () => {
    assert.ok(Technique.options.includes('pairwise'));
    assert.ok(Technique.options.includes('exploratory-charter'));
  });

  it('scores manual work by the layer\'s kind, whatever the layer is called', () => {
    const req = {
      title: 't',
      story: { asA: 'a', iWant: 'to', soThat: 'so' },
      criteria: [
        { id: 'AC-1', kind: 'happy', given: 'g', when: 'w', then: 't' },
        { id: 'AC-2', kind: 'negative', given: 'g', when: 'w', then: 't' },
        { id: 'AC-3', kind: 'edge', given: 'g', when: 'w', then: 't' },
      ],
      assumptions: [],
      outOfScope: [],
      openQuestions: [],
      risk: 'low',
      riskReason: 'r',
    } as const;
    const strategy = {
      cases: [
        { layer: 'exploratory', criteria: ['AC-1'] },
        { layer: 'browser', criteria: ['AC-2', 'AC-3'] },
      ],
      checklist: [],
      checklistItems: [],
    };
    // @ts-expect-error: only the fields the score reads
    const health = planHealth(req, strategy, TEAM);
    const automated = health.parts.find((p) => p.name === 'Automated rather than manual');
    assert.equal(automated?.detail, '1 of 2 cases');
  });
});
