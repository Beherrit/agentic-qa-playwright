import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from './lib/agent.ts';
import { CONFIG_FILE, config, ROOT } from './lib/paths.ts';
import { Survey } from './lib/schemas.ts';
import { prompt, save } from './lib/store.ts';

/**
 * The first hour on a new project: an agent reads the suite and drafts the product brief, the test conventions and
 * the suite settings of qa.config.json. Every path and command it names is checked here before anything is written.
 *
 *   npx agentic-qa survey          prints the drafts and leaves them in qa-run/
 *   npx agentic-qa survey --yes    also writes the documents and updates qa.config.json
 */

const IGNORE = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'qa-run', 'dist', 'build', '.next', 'coverage']);

/** The project's files, two levels deep, so the agent knows where to look without listing the whole tree. */
export function tree(root: string, depth = 2): string[] {
  const out: string[] = [];
  const walk = (dir: string, level: number): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
      const rel = path.relative(root, path.join(dir, entry.name)).replaceAll('\\', '/');
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory() && level < depth) walk(path.join(dir, entry.name), level + 1);
    }
  };
  walk(root, 1);
  return out;
}

type Checked = { survey: Survey; problems: string[] };

/**
 * What the agent said, checked against the project: a glob that matches no file, an import that does not exist,
 * a folder that is not there, a test command that is not Playwright, each becomes a problem for the person to
 * settle, and the setting is dropped or kept as it was.
 */
export function checkSurvey(survey: Survey, root: string): Checked {
  const problems: string[] = [];
  const has = (file: string): boolean => Boolean(file) && !path.isAbsolute(file) && fs.existsSync(path.join(root, file));
  const matches = (glob: string): boolean => {
    try {
      return fs.globSync(glob, { cwd: root }).length > 0;
    } catch {
      return false;
    }
  };

  const layout = { ...survey.layout };
  if (!matches(layout.specGlob)) {
    problems.push(`suite.specGlob "${layout.specGlob}" matches no file; kept as ${config.suite.specGlob}.`);
    layout.specGlob = config.suite.specGlob;
  }
  if (layout.testImport !== '@playwright/test' && !has(layout.testImport)) {
    problems.push(`suite.testImport "${layout.testImport}" does not exist; kept as ${config.suite.testImport}.`);
    layout.testImport = config.suite.testImport;
  }
  const writable = layout.writable.map((dir) => (dir.endsWith('/') ? dir : `${dir}/`)).filter((dir) => {
    if (has(dir)) return true;
    problems.push(`writable folder "${dir}" does not exist; left out.`);
    return false;
  });
  layout.writable = writable.length ? writable : config.writable;
  if (!writable.length) problems.push(`no writable folder survived; kept as ${config.writable.join(', ')}.`);

  const commands = { ...survey.commands };
  if (!/\bplaywright test\b/.test(commands.test)) {
    problems.push(`the test command "${commands.test}" is not Playwright; kept as ${config.suite.commands.test}.`);
    commands.test = config.suite.commands.test;
  }
  const auth = { ...survey.auth };
  if (auth.setup && !auth.storageState) {
    problems.push('auth.setup was named without the file it writes; both left unset.');
    auth.setup = null;
  }
  if (auth.storageState && !auth.setup) auth.storageState = null;

  const app: Survey['app'] = { name: survey.app.name, baseUrl: /^https?:\/\/\S+$/.test(survey.app.baseUrl) ? survey.app.baseUrl : '' };
  if (!app.baseUrl) problems.push('the app address is unknown; fill in app.baseUrl.');
  for (const [name, text] of [
    ['brief', survey.brief],
    ['conventions', survey.conventions],
  ] as const) {
    if (!/^#\s+\S/m.test(text)) problems.push(`the ${name} has no heading; it is written as given.`);
  }
  return { survey: { ...survey, app, layout, commands, auth }, problems: [...problems, ...survey.gaps] };
}

/** The config with the survey's findings merged in. Only the settings the survey is about change. */
export function mergedConfig(current: Record<string, unknown>, survey: Survey): Record<string, unknown> {
  const app: Record<string, unknown> = { ...(current.app as Record<string, unknown>), name: survey.app.name || (current.app as { name: string }).name };
  if (survey.app.baseUrl) app.baseUrl = survey.app.baseUrl;
  return {
    ...current,
    app,
    writable: survey.layout.writable,
    suite: { specGlob: survey.layout.specGlob, testImport: survey.layout.testImport, commands: survey.commands },
    personas: survey.personas,
    auth: { setup: survey.auth.setup, storageState: survey.auth.storageState },
  };
}

const NOTE = (what: string): string => `<!-- Drafted by the suite surveyor from the code. A person checks this ${what} before the first run. -->\n\n`;

export function surveyMd(checked: Checked): string {
  const { survey, problems } = checked;
  return `# Survey of the suite

**${problems.length ? `${problems.length} thing(s) for a person to settle.` : 'Nothing left to settle.'}** ${survey.app.name}${survey.app.baseUrl ? ` at ${survey.app.baseUrl}` : ''}; specs \`${survey.layout.specGlob}\`; writable ${survey.layout.writable.join(', ')}.

| Setting | Found |
|---|---|
| Test command | \`${survey.commands.test}\` |
| Typecheck | \`${survey.commands.typecheck}\` |
| Lint | \`${survey.commands.lint}\` |
| Specs import test from | \`${survey.layout.testImport}\` |
| Persona variable | \`${survey.personas.envVar}\`${survey.personas.default ? `, default \`${survey.personas.default}\`` : ''}${survey.personas.list.length ? ` (${survey.personas.list.join(', ')})` : ''} |
| Sign-in | ${survey.auth.setup ? `\`${survey.auth.setup}\` writes \`${survey.auth.storageState}\`` : 'through the app'}. ${survey.auth.how} |

${problems.length ? `## To settle\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\n` : ''}## Product brief (draft)

${survey.brief.trim()}

## Test conventions (draft)

${survey.conventions.trim()}
`;
}

export async function survey(options: { write: boolean }): Promise<Checked> {
  const files = tree(ROOT);
  const read = (file: string): string => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8').slice(0, 6000) : '');
  const playwrightConfig = files.find((f) => /^playwright\.config\.[cm]?[jt]s$/.test(f)) ?? '';
  const { output } = await runAgent({
    role: 'suite-surveyor',
    instructions: prompt('suite-surveyor'),
    task: `Survey this project for the QA pipeline. The current ${CONFIG_FILE} is a starting point; replace what you can see is different.

<files>
${files.join('\n')}
</files>

<package-json>
${read('package.json')}
</package-json>

<playwright-config file="${playwrightConfig}">
${read(playwrightConfig)}
</playwright-config>

<current-config>
${read(CONFIG_FILE)}
</current-config>

<readme>
${read('README.md')}
</readme>`,
    schema: Survey,
    access: 'read',
    maxTurns: 40,
  });

  const checked = checkSurvey(output, ROOT);
  const markdown = surveyMd(checked);
  save('survey.json', checked);
  save('survey.md', markdown);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_FILE), 'utf8')) as Record<string, unknown>;
  const merged = mergedConfig(raw, checked.survey);
  save('qa.config.proposed.json', merged);
  console.log(`\n${markdown}`);

  if (options.write) {
    fs.writeFileSync(path.join(ROOT, config.app.brief), `${NOTE('brief')}${checked.survey.brief.trim()}\n`);
    fs.writeFileSync(path.join(ROOT, config.conventions), `${NOTE('page')}${checked.survey.conventions.trim()}\n`);
    fs.writeFileSync(path.join(ROOT, CONFIG_FILE), `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`\nWrote ${config.app.brief}, ${config.conventions} and ${CONFIG_FILE}. Run \`npx agentic-qa doctor\` next.`);
  } else {
    console.log('\nNothing written. The drafts are in qa-run/ (survey.md, qa.config.proposed.json). Run again with --yes to write them.');
  }
  return checked;
}
