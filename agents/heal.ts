import { runHealGates, savePatch } from './gates.ts';
import { runAgent } from './lib/agent.ts';
import { config, projectDoc } from './lib/paths.ts';
import { gatesMd, table } from './lib/render.ts';
import { Healing, type Triage } from './lib/schemas.ts';
import { exists, jobSummary, load, prompt, save, setOutput } from './lib/store.ts';

/**
 * Repairs the tests that triage found to be at fault, and leaves the repair as a patch for a pull request.
 * Product bugs, flaky tests and environment trouble are not touched: only a failure triage called a test defect,
 * with more than low confidence, is handed to the healer.
 *
 * Usage: npm run heal      (after `npm run triage`; reads qa-run/triage.json and test-results/)
 */

type Reported = { test: string; file: string; error: string; evidence: string[] };
type TriageFile = Triage & { reported?: Reported[] };

/** Which failures the healer may work on, each with what Playwright reported for it. */
export function defects(triage: TriageFile): (Triage['failures'][number] & { error: string; evidenceFiles: string[] })[] {
  return triage.failures
    .filter((failure) => failure.verdict === 'test-defect' && failure.confidence !== 'low')
    .map((failure) => {
      const reported = (triage.reported ?? []).find((r) => r.test === failure.test || r.test.endsWith(failure.test) || failure.test.endsWith(r.test));
      return { ...failure, error: reported?.error ?? '', evidenceFiles: reported?.evidence ?? [] };
    });
}

/** The spec files to rerun: the ones the failing tests live in, without line numbers. */
export const specFiles = (failures: { file: string }[]): string[] => [...new Set(failures.map((f) => f.file.replace(/:\d+$/, '')))];

export function healMd(healing: Healing, gates: ReturnType<typeof runHealGates>, runUrl: string | null): string {
  const tried = healing.fixes.length + healing.notFixed.length;
  return `## Self-healing: ${healing.fixes.length} of ${tried} test defect(s) repaired

**Verdict: ${gates.passed ? 'repair ready, the gates passed' : 'repair rejected by the gates'}.** A person still reads the diff before merging.

Regression failed, and triage found that these failures were the tests' fault rather than the app's.${runUrl ? ` [The failing run](${runUrl}).` : ''}

${healing.summary}

### What changed

${table(
  ['Test', 'What had changed in the app', 'What changed in the test'],
  healing.fixes.map((fix) => [`${fix.test}<br>\`${fix.file}\``, fix.cause, fix.change]),
)}
${healing.notFixed.length ? `\n### Left alone\n\n${healing.notFixed.map((n) => `- ${n.test}: ${n.reason}`).join('\n')}\n` : ''}
A repair may change how a test finds things, or a value that is now out of date. It may not change what the test checks. The gates below hold it to that.

${gatesMd(gates, 3)}`;
}

export async function heal(): Promise<void> {
  if (!exists('triage.json')) {
    console.error('qa-run/triage.json not found. Run the triage first.');
    process.exit(1);
  }
  const toHeal = defects(load<TriageFile>('triage.json'));
  if (toHeal.length === 0) {
    console.log('Triage found no test defects. Nothing to heal.');
    setOutput('healed', false);
    return;
  }

  const { output } = await runAgent({
    role: 'test-healer',
    instructions: prompt('test-healer'),
    task: `${toHeal.length} test(s) failed because of the tests themselves. The app is ${config.app.name} at ${config.app.baseUrl}.

You may write only inside: ${config.writable.join(', ')}

<test-defects>
${JSON.stringify(toHeal, null, 2)}
</test-defects>

<test-conventions>
${projectDoc(config.conventions)}
</test-conventions>`,
    schema: Healing,
    access: 'write',
    browser: true,
    maxTurns: 60,
  });

  const gates = output.fixes.length ? runHealGates(specFiles(toHeal)) : null;
  const healed = gates?.passed ?? false;
  if (gates) {
    const markdown = healMd(output, gates, process.env.RUN_URL || null);
    savePatch('heal.patch');
    save('heal.md', markdown);
    jobSummary(markdown);
  } else {
    jobSummary(
      `## Self-healing: nothing repaired\n\n**Verdict: no repair.** The healer changed no file.\n\n${output.summary}\n\n${output.notFixed.map((n) => `- ${n.test}: ${n.reason}`).join('\n')}`,
    );
  }
  save('heal.json', { ...output, gates });
  setOutput('healed', healed);
  setOutput('title', `fix(tests): repair ${output.fixes.length} test defect(s) found by triage`);
  // For the job that opens the pull request, which has no config loaded.
  setOutput('writable', config.writable.join(' '));
  console.log(healed ? '\nRepair ready: qa-run/heal.patch' : '\nNo repair to offer.');
}

// Only when run as a script, so the unit tests can import the helpers above.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('agents/heal.ts')) await heal();
