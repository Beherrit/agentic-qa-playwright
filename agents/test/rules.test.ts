import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { blockedNames, textOfEdit } from '../lib/clean-room.ts';
import { withHandoff } from '../lib/handoff.ts';
import { Conversion, Settings } from '../lib/migrate/schemas.ts';
import { PerfAnalysis } from '../lib/perf/analyst.ts';
import * as S from '../lib/schemas.ts';
import { ROLE_TIERS, Tier } from '../lib/tiers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROMPTS = path.join(ROOT, 'agents/prompts');
const CARD_FIELDS = ['Tier', 'Mission', 'Inputs', 'Allowed tools', 'Must never', 'Output contract', 'Done when', 'Escalate when'];
const roles = fs
  .readdirSync(PROMPTS)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();

/** The card's fields in the order they appear, and the tier it states. */
function cardOf(text: string): { fields: string[]; tier: string | null } {
  const card = /^## Card\n\n((?:- \*\*.+\n)+)/m.exec(text)?.[1] ?? '';
  const fields = [...card.matchAll(/^- \*\*(.+?):\*\* /gm)].map((m) => m[1]);
  const tier = /^- \*\*Tier:\*\* ([a-z]+)/m.exec(card)?.[1] ?? null;
  return { fields, tier };
}

describe('agent rules', () => {
  it('gives every prompt a tier, and every tier entry a prompt', () => {
    assert.deepEqual(Object.keys(ROLE_TIERS).sort(), roles);
  });

  it('opens every prompt with a complete card whose tier matches the code', () => {
    for (const role of roles) {
      const { fields, tier } = cardOf(fs.readFileSync(path.join(PROMPTS, `${role}.md`), 'utf8'));
      assert.deepEqual(fields, CARD_FIELDS, `${role}: the card's fields`);
      assert.equal(tier, ROLE_TIERS[role], `${role}: the card's tier`);
    }
  });

  it('lists every role under its tier in docs/AGENT-RULES.md', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/AGENT-RULES.md'), 'utf8');
    for (const tier of Tier.options) {
      const row = doc.split('\n').find((line) => line.startsWith(`| ${tier} |`)) ?? '';
      assert.ok(row, `a row for ${tier}`);
      for (const [role, its] of Object.entries(ROLE_TIERS)) {
        assert.equal(row.includes(`\`${role}\``), its === tier, `${role} ${its === tier ? 'belongs' : 'does not belong'} in the ${tier} row`);
      }
    }
  });

  it('gives every role an object answer, so every agent hands in a handoff', () => {
    const { Plan, Reconciled } = S.strategySchemas(['e2e']);
    const answers: Record<string, z.ZodType> = {
      'request-screener': S.Screening,
      skeptic: S.Skepticism,
      'requirements-analyst': S.Requirements,
      'technical-reviewer': S.TechnicalReview,
      'test-architect': Plan,
      'plan-critic': S.Checklist,
      'plan-reconciler': Reconciled,
      'automation-engineer': S.Generation,
      saboteur: S.Sabotage,
      'code-reviewer': S.Review,
      'failure-triager': S.Triage,
      'test-healer': S.Healing,
      'suite-surveyor': S.Survey,
      'ticket-writer': S.TicketDraft,
      'performance-analyst': PerfAnalysis,
      'settings-migrator': Settings,
      'test-migrator': Conversion,
    };
    assert.deepEqual(Object.keys(answers).sort(), roles);
    for (const [role, schema] of Object.entries(answers)) assert.notEqual(withHandoff(schema), schema, `${role} gets a handoff`);
  });

  it('keeps the repository rules and the dev-time agents in step with the tiers', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
    assert.match(rules, /docs\/AGENT-RULES\.md/);
    const agents: Record<string, string> = { researcher: 'research', builder: 'build', reviewer: 'decide', 'bulk-reader': 'read' };
    for (const [name, tier] of Object.entries(agents)) {
      const text = fs.readFileSync(path.join(ROOT, '.claude/agents', `${name}.md`), 'utf8');
      assert.match(text, new RegExp(`^name: ${name}$`, 'm'));
      assert.match(text, /^model: \S+$/m);
      assert.equal(cardOf(text).tier, tier, `${name}'s tier`);
    }
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
    assert.match(JSON.stringify(settings.hooks.PreToolUse), /clean-room\.ts/);
  });
});

describe('the clean room', () => {
  it('finds a blocked name however it is written, and nothing in ordinary text', () => {
    // The names are only ever written here encoded, so this file passes its own scan.
    const name = Buffer.from('QmxhY2sgQm9sdA==', 'base64').toString();
    for (const form of [name, name.toUpperCase(), name.replace(' ', '-'), name.replace(' ', ''), `the ${name}'s template`]) {
      assert.equal(blockedNames(form), 1, form.length + ' chars');
    }
    assert.equal(blockedNames('a black cat bolted, the checkout form shows an error'), 0);
  });

  it('reads the text of Write, Edit and MultiEdit calls', () => {
    assert.match(textOfEdit({ file_path: 'a.md', content: 'x' }), /a\.md\nx/);
    assert.match(textOfEdit({ edits: [{ new_string: 'y' }, { new_string: 'z' }] }), /y\nz/);
    assert.equal(textOfEdit(null), '');
  });

  it('has no blocked name in any tracked file', () => {
    let files: string[];
    try {
      files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      return; // Not a git checkout (an installed package): nothing to scan.
    }
    const dirty = files.filter((file) => {
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) return false;
      const buffer = fs.readFileSync(full);
      if (buffer.includes(0)) return false; // binary
      return blockedNames(`${file}\n${buffer.toString('utf8')}`) > 0;
    });
    assert.deepEqual(dirty, []);
  });
});
