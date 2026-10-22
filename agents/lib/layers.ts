import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Test layers: where a test case lives, who owns it and what it is good at proving. A project lists its own in
 * qa.config.json, cheapest first ("we have Vitest component tests, JUnit service tests and the browser suite"), so
 * the plan is a plan for the whole team rather than for the browser suite alone. Without a list, the three layers
 * the pipeline has always used apply.
 *
 * Every layer has a kind, which is all the rest of the engine looks at:
 *   e2e     the browser suite this pipeline writes, gates and opens a pull request for. Exactly one layer has it.
 *   lower   proven below the browser by a team that owns the code: unit, component, service, API, contract.
 *   manual  judgement a script cannot make, and exploratory charters.
 *
 * Pure functions with the layers passed in, so this file reads no config and agents/test/ can check it alone.
 */

export const LayerKind = z.enum(['e2e', 'lower', 'manual']);
export type LayerKind = z.infer<typeof LayerKind>;

export const LayerSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,30}$/)
    .describe('Short and stable, e.g. unit, component, api, e2e. Test cases and tracker tasks refer to it.'),
  name: z.string().min(1).describe('What people call it, e.g. "Component tests"'),
  kind: LayerKind,
  proves: z.string().min(1).describe('What this layer is the cheapest place to prove. The architect decides by it.'),
  tools: z.string().default('').describe('e.g. "Vitest and Testing Library"'),
  owner: z.string().default('').describe('Who writes and keeps these tests, e.g. "Frontend developers"'),
  /**
   * A checkout of the repository this layer's tests live in, relative to the project root or absolute. The agents may
   * read it (never write) to find tests that already cover a requirement. In CI, check it out next to this one.
   */
  repo: z.string().min(1).optional(),
});
export type Layer = z.infer<typeof LayerSchema>;

/** The layers when a project names none: what the pipeline did before layers could be configured. */
export const DEFAULT_LAYERS: Layer[] = [
  {
    id: 'lower-layer',
    name: 'Below the browser',
    kind: 'lower',
    proves: 'Rules a unit, component or API test could prove with access to the code: validation, calculations, formatting, error mapping.',
    tools: '',
    owner: 'Developers',
  },
  {
    id: 'e2e',
    name: 'Browser end to end',
    kind: 'e2e',
    proves: 'Journeys across pages and anything only visible once the whole app is assembled in a real browser.',
    tools: 'Playwright',
    owner: 'QA (this pipeline writes these)',
  },
  {
    id: 'manual',
    name: 'Manual',
    kind: 'manual',
    proves: 'Judgement a script cannot make, and exploratory charters.',
    tools: '',
    owner: 'QA',
  },
];

/** The config's list, checked: ids are unique and exactly one layer is the browser suite. */
export const LayersSchema = z
  .array(LayerSchema)
  .min(1)
  .superRefine((layers, ctx) => {
    const ids = layers.map((l) => l.id);
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (repeated.length) ctx.addIssue({ code: 'custom', message: `Layer ids must be unique; repeated: ${[...new Set(repeated)].join(', ')}.` });
    const e2e = layers.filter((l) => l.kind === 'e2e');
    if (e2e.length !== 1) {
      ctx.addIssue({ code: 'custom', message: `Exactly one layer must have kind "e2e" (the browser suite this pipeline writes); found ${e2e.length}.` });
    }
  });

export const layerIds = (layers: Layer[]): [string, ...string[]] => {
  const ids = layers.map((l) => l.id);
  if (!ids.length) throw new Error('No test layers configured.');
  return ids as [string, ...string[]];
};

export const layerById = (layers: Layer[], id: string): Layer | undefined => layers.find((l) => l.id === id);

/** What the three original layer ids mean, for a plan written before a project named its own layers. */
const LEGACY_KINDS: Record<string, LayerKind> = { e2e: 'e2e', 'lower-layer': 'lower', manual: 'manual' };

/**
 * The kind of a case's layer. The original ids keep their meaning even after a project renames its layers, so a plan
 * analysed before the rename still sends its browser cases to the engineer. Any other unknown id counts as lower:
 * not ours to automate, and not lost.
 */
export const kindOf = (layers: Layer[], id: string): LayerKind => layerById(layers, id)?.kind ?? LEGACY_KINDS[id] ?? 'lower';

export const isE2e = (layers: Layer[], c: { layer: string }): boolean => kindOf(layers, c.layer) === 'e2e';

/** The browser suite's layer id: what the engineer automates and the traceability gate checks. */
export const e2eId = (layers: Layer[]): string => layers.find((l) => l.kind === 'e2e')?.id ?? 'e2e';

/** A layer's repository as an absolute path, or null when it has none. */
export function layerRepoPath(layer: Layer, root: string): string | null {
  return layer.repo ? path.resolve(root, layer.repo) : null;
}

/** A layer whose tests live in this repository, so there is nothing extra to check out or search. */
export const inThisRepo = (layer: Layer, root: string): boolean => Boolean(layer.repo) && path.resolve(root, layer.repo!) === path.resolve(root);

/** The repositories the read-only agents may search for existing coverage: every other layer's that exists on disk. */
export function coverageRoots(layers: Layer[], root: string, exists: (dir: string) => boolean = fs.existsSync): { id: string; dir: string }[] {
  return layers
    .map((layer) => ({ id: layer.id, dir: layerRepoPath(layer, root) }))
    .filter((entry): entry is { id: string; dir: string } => entry.dir !== null && entry.dir !== path.resolve(root) && exists(entry.dir));
}

/** The layers as the strategy agents see them: one line each, cheapest first, with where to look for existing tests. */
export function layersText(layers: Layer[], root: string, exists: (dir: string) => boolean = fs.existsSync): string {
  const lines = layers.map((layer, i) => {
    const repo = layerRepoPath(layer, root);
    const where = repo && repo !== path.resolve(root) ? (exists(repo) ? ` Tests live in ${repo}; search it before planning a new one.` : ` (Its repository, ${layer.repo}, is not checked out here.)`) : '';
    const tools = layer.tools ? ` Tools: ${layer.tools}.` : '';
    const owner = layer.owner ? ` Owner: ${layer.owner}.` : '';
    const automated = layer.kind === 'e2e' ? ' This pipeline writes these.' : '';
    return `${i + 1}. \`${layer.id}\` (${layer.name}, ${layer.kind}). ${layer.proves}${tools}${owner}${automated}${where}`;
  });
  return `<test-layers cheapest-first="true">\n${lines.join('\n')}\n</test-layers>`;
}

/**
 * The deterministic pass over the final cases. A case on a layer the project does not list is moved to the nearest
 * fit by kind (the old ids e2e, lower-layer and manual still mean what they did), and an exploratory charter, which
 * a script cannot run, always goes to a manual layer. Returns the cases and a line for each change.
 */
export function placeCases<C extends { id: string; layer: string; technique: string }>(cases: C[], layers: Layer[]): { cases: C[]; moved: string[] } {
  const moved: string[] = [];
  const firstOfKind = (kind: LayerKind): Layer | undefined => layers.find((l) => l.kind === kind);
  const placed = cases.map((c) => {
    let layer = c.layer;
    if (!layerById(layers, layer)) {
      const target = firstOfKind(LEGACY_KINDS[layer] ?? 'lower') ?? layers[0];
      moved.push(`${c.id}: layer "${layer}" is not one of this project's, so it is on "${target.id}".`);
      layer = target.id;
    }
    if (c.technique === 'exploratory-charter' && kindOf(layers, layer) !== 'manual') {
      const manual = firstOfKind('manual');
      if (manual) {
        moved.push(`${c.id}: an exploratory charter is run by a person, so it moved from "${layer}" to "${manual.id}".`);
        layer = manual.id;
      }
    }
    return layer === c.layer ? c : { ...c, layer };
  });
  return { cases: placed, moved };
}

/**
 * Existing coverage the architect names in another layer's repository is written "<layer id>:<path>". Returns the
 * layer and the path inside it, or null for a path in this repository.
 */
export function splitLayerPath(file: string, layers: Layer[]): { layer: Layer; file: string } | null {
  const match = /^([a-z][a-z0-9-]{0,30}):(?![\\/])(.+)$/.exec(file.trim());
  if (!match) return null;
  const layer = layerById(layers, match[1]);
  return layer ? { layer, file: match[2] } : null;
}

/** A path that stays inside its repository: nothing absolute, no "..". */
const inside = (file: string): boolean => Boolean(file) && !/^([a-zA-Z]:|[\\/])/.test(file) && !file.split(/[\\/]/).includes('..');

/**
 * Keeps only the existing coverage whose file is really there: in this repository, or in the named layer's checkout.
 * A layer whose repository is not checked out here cannot be checked, so its entries are kept and say so.
 */
export function checkCoverage<E extends { file: string }>(
  entries: E[],
  layers: Layer[],
  root: string,
  exists: (file: string) => boolean = fs.existsSync,
): { kept: E[]; dropped: string[] } {
  const kept: E[] = [];
  const dropped: string[] = [];
  for (const entry of entries) {
    const split = splitLayerPath(entry.file, layers);
    const repo = split ? layerRepoPath(split.layer, root) : root;
    const file = split ? split.file : entry.file;
    if (!inside(file)) {
      dropped.push(`Already covered: ${entry.file} is outside its repository.`);
      continue;
    }
    if (split && (!repo || !exists(repo))) {
      kept.push(entry);
      continue;
    }
    if (exists(path.join(repo ?? root, file))) kept.push(entry);
    else dropped.push(`Already covered: ${entry.file} does not exist.`);
  }
  return { kept, dropped };
}

/** How many cases each layer got, in the project's order, for the report. Layers with none are left out. */
export function countByLayer(cases: { layer: string }[], layers: Layer[]): { layer: Layer; count: number }[] {
  const known = layers.map((layer) => ({ layer, count: cases.filter((c) => c.layer === layer.id).length }));
  return known.filter((entry) => entry.count > 0);
}
