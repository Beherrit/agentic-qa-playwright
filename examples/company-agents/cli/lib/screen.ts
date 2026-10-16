import { Screening } from '../../schemas/schemas.ts';
import { runAgent, tag } from './agent.ts';
import type { CoConfig } from './config.ts';
import { modelFor } from './config.ts';

/**
 * The safety screen in front of every role, in two halves. First, fixed rules: small named patterns for the shape of
 * a request aimed at the agents (delete the repository, send the token to this address, ignore your instructions).
 * No model, so they are cheap and the same every time, and what they find is final. Second, the request screener
 * agent reads whatever the rules let through and decides proceed, refuse or ask.
 *
 * A rule fires on the shape of an attack, not on a word a normal request uses: "the delete button removes the item"
 * passes; "delete the repository" does not. The engine's agents/lib/safety.ts has the fuller set; this is the core.
 */

export type RuleFinding = { rule: string; excerpt: string };

type Rule = { name: string; pattern: RegExp };

const REPO = '(?:codebase|repo|repository|source\\s+code|git\\s+history|(?:main|master|production)\\s+branch|all\\s+branches|database|table|cluster|namespace|channel|workspace|wiki|space)';
const GAP = '(?:(?:the|this|our|my|your|all|every|whole|entire)\\s+)*';
const SECRET = '(?:api[\\s-]?keys?|tokens?|secrets?|passwords?|credentials?|cookies?|env(?:ironment)?\\s+var(?:iable)?s?|\\.env\\b|private\\s+keys?|ssh\\s+keys?|customer\\s+data|personal\\s+data|user\\s+data)';
const DESTINATION = '(?:https?:\\/\\/\\S+|\\S+@\\S+\\.\\S+|(?:a\\s+|the\\s+|my\\s+|an\\s+)?(?:webhook|pastebin|external\\s+(?:server|site|url)|remote\\s+(?:server|host)|third[\\s-]party))';

const RULES: Rule[] = [
  { name: 'destructive/delete-system', pattern: new RegExp(`\\b(?:delete|remove|wipe|erase|destroy|purge|nuke|drop)\\s+${GAP}${REPO}\\b`, 'i') },
  { name: 'destructive/force-push', pattern: /\bgit\s+push\b[^\n.;]*?(?:--force|\s-f)\b|\bforce[\s-]push\b/i },
  { name: 'destructive/git-rewrite', pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|filter-(?:branch|repo))\b/i },
  { name: 'destructive/rm-rf', pattern: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i },
  { name: 'destructive/deploy-or-merge', pattern: /\b(?:merge|deploy|roll\s*back|revert|release|ship)\s+(?:this|it|the\s+(?:mr|pr|merge\s+request|pull\s+request|change))\s+(?:now|immediately|without\s+review|yourself)\b/i },
  { name: 'exfiltration/send-secret', pattern: new RegExp(`\\b(?:send|post|email|upload|leak|forward|dump|curl|copy|paste)\\s+(?:\\S+\\s+){0,4}?${SECRET}\\b[^\\n.;]{0,60}?\\b(?:to|at|into|via)\\s+${DESTINATION}`, 'i') },
  { name: 'exfiltration/reveal-secret', pattern: /\b(?:reveal|print|echo|dump|leak|cat|show\s+me)\s+(?:the\s+|all\s+|your\s+)?(?:\.env\b|process\.env|env(?:ironment)?\s+variables?|ci\s+secrets|github_token|anthropic_api_key|slack_bot_token|ssh\s+keys?)/i },
  { name: 'exfiltration/exfiltrate', pattern: /\bexfiltrat\w*/i },
  { name: 'guardrail-bypass/skip-checks', pattern: /\b(?:skip|bypass|disable|turn\s+off|ignore)\s+(?:the\s+)?(?:ci|checks|review|approval|screen(?:ing)?|guardrails?|rate\s+limit|audit(?:\s+log)?|safety)\b/i },
  { name: 'injection/ignore-instructions', pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+|your\s+|the\s+|any\s+)?(?:previous|prior|above|earlier|system)?\s*(?:instructions?|rules|prompt|guidelines)\b/i },
  { name: 'injection/role-swap', pattern: /\byou\s+are\s+now\s+(?:a|an|the)\b|\bact\s+as\s+(?:an?\s+)?(?:unrestricted|jailbroken|admin(?:istrator)?|root)\b|\bdeveloper\s+mode\b/i },
  { name: 'injection/to-the-agent', pattern: /\b(?:dear|hey|hi|attention)\s+(?:ai|agent|assistant|bot|claude|model|reviewer\s+bot)\b[,:]/i },
  { name: 'injection/hidden-text', pattern: /<!--[^>]*?(?:ignore|instruction|approve|post|send|you\s+are)[^>]*?-->|style\s*=\s*"[^"]*(?:display\s*:\s*none|font-size\s*:\s*0)/i },
  { name: 'external-voice/speak-publicly', pattern: /\b(?:post|publish|tweet|announce|reply)\s+(?:this\s+|it\s+)?(?:to|on|at)\s+(?:twitter|x\.com|linkedin|the\s+press|the\s+public|our\s+customers|the\s+status\s+page|hacker\s+news|reddit)\b/i },
];

/** The fixed half. Every rule that fires, with the text that fired it. */
export function fixedRules(text: string): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) findings.push({ rule: rule.name, excerpt: match[0].slice(0, 120) });
  }
  return findings;
}

function categoryOf(rule: string): Screening['category'] {
  const head = rule.split('/')[0];
  return Screening.shape.category.options.includes(head as Screening['category']) ? (head as Screening['category']) : 'other';
}

/**
 * Both halves. Fixed findings are final: a refuse from a rule never reaches the agent. Otherwise the screener agent
 * reads the text as data and decides.
 */
export async function screen(config: CoConfig, cwd: string, role: string, text: string): Promise<Screening & { rules: RuleFinding[] }> {
  const rules = fixedRules(text);
  if (rules.length) {
    return {
      verdict: 'refuse',
      category: categoryOf(rules[0].rule),
      reasons: rules.map((f) => `${f.rule}: "${f.excerpt}"`),
      question: null,
      rules,
    };
  }
  const result = await runAgent({
    role: 'request-screener',
    schema: Screening,
    cwd,
    model: modelFor(config, 'request-screener'),
    maxTurns: 8,
    maxBudgetUsd: 0.5,
    task: `The next role is: ${role}. The company builds: ${config.company}.\n\nScreen this request.\n\n${tag('request', text)}`,
  });
  return { ...result.output, rules };
}
