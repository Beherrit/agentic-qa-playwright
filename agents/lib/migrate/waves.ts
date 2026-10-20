import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from '../agent.ts';
import { config, projectDoc, ROOT } from '../paths.ts';
import { PKG_ROOT } from '../pkg.ts';
import { commands } from '../suite.ts';
import { prompt } from '../store.ts';
import { runWaveGates } from './gates.ts';
import { checkParity, type ParityReport } from './parity.ts';
import { riskGuidance } from './rules.ts';
import { Conversion, Settings } from './schemas.ts';
import { applySettings, configLoads, evidenced, settingsMd } from './settings.ts';
import type { Inventory, Wave } from './types.ts';
import type { GateReport } from '../../gates.ts';

/**
 * One wave at a time. The settings wave asks for values and writes the config; every other wave asks for code,
 * then holds it to the parity check and the gates. A wave that fails gets one fix round with the problems spelled
 * out, as the pipeline's engineer does; a second failure stops the migration where a person can see it.
 */

export type WaveOutcome = {
  wave: Wave;
  passed: boolean;
  attempts: number;
  summary: string;
  markdown: string;
  conversion?: Conversion;
  parity?: ParityReport;
  gates?: GateReport;
};

const MAX_INLINE = 14_000;

/** A file's content for the task, inline when small enough, otherwise its path for the agent to read. */
function sourceBlock(source: string, file: string): string {
  const full = path.join(source, file);
  const content = fs.readFileSync(full, 'utf8');
  return content.length <= MAX_INLINE ? `<old-file path="${full}">\n${content}\n</old-file>` : `<old-file path="${full}" note="read it: too long to inline" />`;
}

export async function runSettingsWave(source: string, inventory: Inventory, wave: Wave): Promise<WaveOutcome> {
  const { output } = await runAgent({
    role: 'settings-migrator',
    instructions: prompt('settings-migrator'),
    task: `The old project is at ${source} (${inventory.language}, ${inventory.framework}). Its configuration files, as the inventory found them:
${wave.sources.map((f) => `- ${path.join(source, f)}`).join('\n')}

Test runner setup that may hold settings too:
${inventory.files
  .filter((f) => f.kind === 'util')
  .map((f) => `- ${path.join(source, f.path)}`)
  .join('\n') || '- none found'}

Answer with every setting you can point at.`,
    schema: Settings,
    access: 'read',
    maxTurns: 25,
  });
  const { settings, dropped } = evidenced(output);
  const written = applySettings(ROOT, settings);
  // The config was read before this wave ran. The waves after it, and the browser they get, need the new address.
  if (settings.baseUrl) config.app.baseUrl = settings.baseUrl;
  if (settings.appName) config.app.name = settings.appName;
  if (settings.personas.envVar) config.personas = settings.personas;
  const loads = configLoads(ROOT, commands.test);
  const markdown = `${settingsMd(settings, dropped, written)}\n\n${loads.ok ? '**Playwright loads the new config.**' : `**Playwright rejects the new config.**\n\n\`\`\`\n${loads.output}\n\`\`\``}`;
  return { wave, passed: loads.ok, attempts: 1, summary: loads.ok ? `${settings.evidence.length} settings carried over` : 'the config does not load', markdown };
}

function codeTask(source: string, inventory: Inventory, wave: Wave, previous: string[]): string {
  const inWave = (name: string) => !wave.names || wave.names.includes(name);
  const tests = inventory.files
    .filter((f) => wave.sources.includes(f.path) && f.tests.some((t) => inWave(t.name)))
    .map((f) => `${f.path}: ${f.tests.filter((t) => inWave(t.name)).map((t) => `${t.name} (${t.assertions} assertion${t.assertions === 1 ? '' : 's'}, line ${t.line})`).join('; ')}`);
  const risks = inventory.files
    .filter((f) => wave.sources.includes(f.path) && f.risks.length)
    .map((f) => `${f.path}: ${f.risks.join(', ')}`);
  const guidance = [...new Set(wave.risks ?? [])].map((r) => `- ${r}: ${riskGuidance(r)}`);
  const existing = ['pages', 'fixtures', 'tests'].flatMap((dir) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).map((f) => `${dir}/${f}`) : []));
  return `Convert the "${wave.name}" wave (${wave.kind}) of a ${inventory.language} ${inventory.framework} Selenium suite to Playwright. The app is ${config.app.name} at ${config.app.baseUrl}.

You may write only inside: ${config.writable.join(', ')}. The test command is \`${commands.test}\`.

Old tests in this wave, with the assertion counts the gate will hold you to${wave.names ? ` (only these ${wave.names.length} of the file's tests; the rest belong to other waves)` : ''}:
${tests.join('\n') || '- none: this wave is utilities and page objects only'}
${inventory.assertionHelpers.length ? `\nOld helpers that assert (a call to one counts as an assertion): ${inventory.assertionHelpers.join(', ')}` : ''}
${risks.length ? `\nGrid habits the inventory found in these files, and what to do with each:\n${risks.join('\n')}\n${guidance.join('\n')}` : ''}

Files already in the new project: ${existing.join(', ') || 'none yet'}
${previous.length ? `\nEarlier waves converted: ${previous.join(', ')}. Reuse their page objects and fixtures; do not rewrite them.` : ''}

${wave.sources.map((f) => sourceBlock(source, f)).join('\n\n')}

<fixtures-test-ts>
${fs.readFileSync(path.join(ROOT, 'fixtures', 'test.ts'), 'utf8')}
</fixtures-test-ts>

<test-conventions>
${projectDoc(config.conventions)}
</test-conventions>

<project-structure>
${fs.readFileSync(path.join(PKG_ROOT, 'docs', 'project-structure.md'), 'utf8')}
</project-structure>`;
}

const problemsText = (parity: ParityReport, gates: GateReport | undefined): string =>
  [
    ...parity.problems.map((p) => `- parity: ${p}`),
    ...(gates?.results.filter((g) => !g.passed).map((g) => `- gate "${g.name}": ${g.summary}${g.output ? `\n${g.output}` : ''}`) ?? []),
  ].join('\n');

async function convertOnce(task: string): Promise<Conversion> {
  const { output } = await runAgent({ role: 'test-migrator', instructions: prompt('test-migrator'), task, schema: Conversion, access: 'write', browser: 'test', maxTurns: 80 });
  return output;
}

export async function runCodeWave(source: string, inventory: Inventory, wave: Wave, previous: string[]): Promise<WaveOutcome> {
  const readSource = (file: string) => (fs.existsSync(path.join(source, file)) ? fs.readFileSync(path.join(source, file), 'utf8') : null);
  const readTarget = (file: string) => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8') : null);
  const task = codeTask(source, inventory, wave, previous);
  let conversion = await convertOnce(task);
  let parity = checkParity(wave, inventory, conversion, readSource, readTarget);
  let gates = parity.passed ? runWaveGates(ROOT, conversion) : undefined;
  let attempts = 1;
  if (!parity.passed || !gates?.passed) {
    attempts = 2;
    console.log(`Rejected, one fix round:\n${problemsText(parity, gates)}`);
    const fixTask = `${task}

<previous-attempt>
Your previous conversion of this wave was rejected. Fix these and answer again with the full mapping:
${problemsText(parity, gates)}
</previous-attempt>`;
    conversion = await convertOnce(fixTask);
    parity = checkParity(wave, inventory, conversion, readSource, readTarget);
    gates = parity.passed ? runWaveGates(ROOT, conversion) : undefined;
  }
  const passed = parity.passed && Boolean(gates?.passed);
  const summary = passed ? `${conversion.tests.length} test(s) mapped, ${conversion.dropped.length} dropped, gates passed` : parity.passed ? 'the gates failed' : `parity failed: ${parity.problems.length} problem(s)`;
  return { wave, passed, attempts, summary, markdown: '', conversion, parity, gates };
}
