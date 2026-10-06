import { config } from './paths.ts';
import type { Screening } from './schemas.ts';

/**
 * The fixed half of the safety screen: small named rules over the text of a requirement. No model, so it is cheap and
 * the same every time. A rule fires only on the shape of a request aimed at the pipeline (delete the repository, send
 * the token to this address), not on a word that a normal requirement uses ("the delete button removes the item").
 * Whatever a rule finds is final; the agent screen only sees text no rule objected to.
 */

export type Finding = { rule: string; excerpt: string };

/** A rule is named `<category>/<what>`. The category is one of the screening categories. */
type Rule = { name: string; pattern: RegExp };

const REPO_THING = '(?:codebase|code\\s+base|repo|repository|source\\s+code|git\\s+history|commit\\s+history|test\\s+suite|(?:main|master|remote|production)\\s+branch|all\\s+branches)';
const GAP = '(?:(?:the|this|our|my|your|all|every|whole|entire|complete|full)\\s+)*';

const DESTRUCTIVE: Rule[] = [
  { name: 'destructive/delete-repository', pattern: new RegExp(`\\b(?:delete|remove|wipe|erase|destroy|purge|nuke)\\s+${GAP}${REPO_THING}\\b`, 'i') },
  { name: 'destructive/delete-everything', pattern: /\b(?:delete|remove|wipe|erase|destroy)\s+everything\s+(?:in|from|on)\s+(?:the\s+|this\s+|our\s+)?(?:repo|repository|server|disk|drive|project|codebase|machine)\b/i },
  { name: 'destructive/rm-rf', pattern: /\brm\s+-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b|\brm\s+-r\s+-f\b|\brm\s+-f\s+-r\b/i },
  { name: 'destructive/force-push', pattern: /\bgit\s+push\b[^\n.;]*?(?:--force(?:-with-lease)?|\s-f)\b|\bforce[\s-]push\b/i },
  { name: 'destructive/git-rewrite', pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|filter-(?:branch|repo))\b|\brewrite\s+(?:the\s+)?(?:git\s+|commit\s+|repo(?:sitory)?\s+)history\b/i },
  { name: 'destructive/drop-database', pattern: /\bdrop\s+(?:the\s+|all\s+)?(?:database|table|schema)s?\b|\btruncate\s+table\b|\b(?:wipe|erase|destroy)\s+(?:the\s+|all\s+)?(?:production\s+)?database\b/i },
  { name: 'destructive/format-disk', pattern: /\bformat\s+(?:the\s+|my\s+|this\s+)?(?:disk|drive|hard\s+drive|c:)|\bmkfs\b|\bdel\s+\/[sf]\b/i },
];

const SECRET =
  '(?:api[\\s-]?keys?|tokens?|secrets?|passwords?|credentials?|cookies?|env(?:ironment)?\\s+var(?:iable)?s?|\\.env\\b|private\\s+keys?|ssh\\s+keys?|session\\s+ids?|user\\s+data|customer\\s+data|personal\\s+data|users?\\W+(?:emails?|data|details))';
const DESTINATION = '(?:https?:\\/\\/\\S+|\\S+@\\S+\\.\\S+|(?:a\\s+|the\\s+|my\\s+|an\\s+)?(?:webhook|pastebin|attacker|external\\s+(?:server|site|url|host)|remote\\s+(?:server|host)|third[\\s-]party\\s+(?:server|site)))';

const EXFILTRATION: Rule[] = [
  {
    name: 'exfiltration/send-secret',
    pattern: new RegExp(`\\b(?:send|post|email|mail|upload|leak|forward|transmit|dump|curl|copy|paste)\\s+(?:\\S+\\s+){0,4}?${SECRET}\\b[^\\n.;]{0,60}?\\b(?:to|at|into|via)\\s+${DESTINATION}`, 'i'),
  },
  { name: 'exfiltration/exfiltrate', pattern: /\bexfiltrat\w*/i },
  {
    name: 'exfiltration/reveal-secret',
    pattern: /\b(?:reveal|print|echo|dump|leak|cat)\s+(?:the\s+|all\s+|your\s+)?(?:\.env\b|process\.env|env(?:ironment)?\s+variables?|ci\s+secrets|github_token|claude_code_oauth_token|anthropic_api_key|ssh\s+keys?)/i,
  },
  { name: 'exfiltration/read-environment', pattern: /\bprintenv\b|\bprocess\.env\b|\$\{?[A-Z_]*(?:TOKEN|SECRET|API_KEY)[A-Z_]*\}?/ },
];

const SERVICE = '(?:gmail|google|facebook|instagram|twitter|github|gitlab|aws|azure|paypal|stripe|bank|linkedin|office\\s?365|microsoft|slack|jira|icloud|outlook)';
const ATTACK_TOOL = '(?:nmap|sqlmap|hydra|metasploit|nikto|burp\\s?suite|slowloris|hping3?)';
const ATTACK_VERB = '(?:scan|attack|brute[\\s-]?force|ddos|dos|flood|hammer|pentest|exploit|fuzz|crack)';

/** The hosts a requirement may point at: the app's own, its subdomains, and the trackers tickets live in. */
const TRACKERS = ['github.com', 'githubusercontent.com', 'atlassian.net', 'linear.app', 'dev.azure.com', 'visualstudio.com'];

const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

/** The app's host names from the configuration: the app, and where a pull request's preview is deployed. */
export function appHosts(): string[] {
  const urls = [config.app.baseUrl, config.app.previewUrl?.replace(/\{[a-z]+\}/g, 'x')].filter((u): u is string => Boolean(u));
  const hosts: string[] = [];
  for (const url of urls) {
    try {
      hosts.push(bareHost(new URL(url).host));
    } catch {
      // A preview URL that is not a URL on its own simply adds no host.
    }
  }
  if (process.env.JIRA_BASE_URL) {
    try {
      hosts.push(bareHost(new URL(process.env.JIRA_BASE_URL).host));
    } catch {
      // Same: a bad value adds nothing.
    }
  }
  return hosts;
}

const allowed = (host: string, hosts: string[]): boolean => {
  const h = bareHost(host);
  return [...hosts, ...TRACKERS].some((own) => h === own || h.endsWith(`.${own}`));
};

/** A URL is only a target when the sentence acts on it: visit, log in, test, post, call. A link given for reference is not. */
const ACTS_ON = /\b(?:visit|open|go\s+to|navigate|browse|log\s?in|sign\s?in|login|authenticate|test|scan|attack|crawl|submit|post|send|call|request|fetch|curl|hit|load|check)\b[^\n]{0,60}?$/i;

function offTarget(text: string, hosts: string[]): Finding[] {
  const found: Finding[] = [];
  for (const match of text.matchAll(/https?:\/\/([^\s/:?#)"'>\]]+)(?::\d+)?[^\s)"'>\]]*/gi)) {
    if (allowed(match[1], hosts)) continue;
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    if (ACTS_ON.test(before)) found.push({ rule: 'off-target/other-site', excerpt: excerpt(text, match.index, match[0].length) });
  }
  return found;
}

const OFF_TARGET: Rule[] = [
  { name: 'off-target/login-elsewhere', pattern: new RegExp(`\\b(?:log\\s?in|sign\\s?in|login|authenticate)\\s+(?:to|into|on|at)\\s+(?:my\\s+|the\\s+|their\\s+|your\\s+)?${SERVICE}\\b`, 'i') },
  { name: 'off-target/attack-tool', pattern: new RegExp(`\\b${ATTACK_TOOL}\\b`, 'i') },
  // An order to attack, at the start of a sentence or after "please", "then", "and". "Locks the account to prevent brute force" is not one.
  { name: 'off-target/attack-order', pattern: new RegExp(`(?:^|[.!?;:\\n]\\s*|\\b(?:please|then|and|now|also)\\s+)${ATTACK_VERB}\\b(?!\\s+(?:surface|vector|protection|prevention))`, 'im') },
  { name: 'off-target/denial-of-service', pattern: /\b(?:ddos|denial[\s-]of[\s-]service)\s+(?:attack|the|on|against)\b/i },
];

const INJECTION: Rule[] = [
  { name: 'injection/ignore-instructions', pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+)?(?:previous|prior|above|earlier|preceding|former|your|other)\s+(?:\w+\s+)?(?:instructions?|prompts?|rules?|messages?|guidelines?|directions?)/i },
  { name: 'injection/forget-everything', pattern: /\bforget\s+(?:everything|all)\s+(?:above|before|you\s+(?:know|were\s+told))/i },
  { name: 'injection/you-are-now', pattern: /\byou\s+are\s+now\b|\bfrom\s+now\s+on\s+you\b|\bact\s+as\s+(?:an?\s+)?(?:\w+\s+){0,2}(?:assistant|agent|admin|root)\b/i },
  { name: 'injection/system-prompt', pattern: /\bsystem\s+prompt\b|\bnew\s+instructions?\s*:|\bdeveloper\s+mode\b|\bjailbreak\b/i },
  { name: 'injection/as-an-ai', pattern: /\bas\s+an\s+ai\b/i },
  {
    name: 'injection/tool-call',
    pattern: /<\s*\/?\s*(?:tool_call|tool_use|function_calls?|invoke|antml:\w+|system|assistant)\b|\{\s*"(?:tool_name|tool_use|tool|function_call|command)"\s*:|\[\s*(?:system|inst)\s*\]/i,
  },
];

const GATES = '(?:gates?|guardrails?|safeguards?|scope\\s+(?:check|gate)|sabotage|saboteur|safety\\s+(?:screen|checks?)|quality\\s+gates?|pipeline\\s+checks?)';

const GUARDRAIL: Rule[] = [
  { name: 'guardrail-bypass/skip-gates', pattern: new RegExp(`\\b(?:skip|bypass|disable|turn\\s+off|switch\\s+off|ignore|circumvent|weaken|waive|suppress)\\s+(?:\\w+\\s+){0,2}?${GATES}\\b`, 'i') },
  {
    name: 'guardrail-bypass/skip-review',
    pattern: /\b(?:bypass|circumvent|disable|turn\s+off)\s+(?:the\s+|all\s+)?(?:code\s+|human\s+|pull[\s-]request\s+|pr\s+)?review\b(?!\s+(?:form|button|section|page|tab|field|link|widget|modal|dialog|step|screen))|\b(?:always\s+approve|auto-?approve|merge\s+(?:it\s+|this\s+)?without\s+review)\b/i,
  },
  { name: 'guardrail-bypass/mark-not-required', pattern: /\bmark(?:ed)?\s+(?:the\s+)?(?:sabotage|saboteur|gates?|review)\s+(?:as\s+)?(?:not\s+required|optional|passed|passing|approved)\b|\bsabotage\s+(?:is\s+)?not\s+required\b/i },
  { name: 'guardrail-bypass/edit-pipeline', pattern: /\b(?:edit|modify|change|overwrite|rewrite|delete)\s+(?:the\s+)?(?:\.github\/workflows\S*|qa\.config\.json|agents\/\S+|(?:agent\s+)?prompts\/\S+)/i },
];

const RULES: Rule[] = [...DESTRUCTIVE, ...EXFILTRATION, ...OFF_TARGET, ...INJECTION, ...GUARDRAIL];

/** A short stretch of the text around a match, on one line. */
function excerpt(text: string, index: number, length: number): string {
  const line = text.slice(Math.max(0, index - 15), index + length + 25).replace(/\s+/g, ' ').trim();
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}

/** Runs every rule over the text. Empty when nothing in it asks for something the pipeline must not do. */
export function screenRules(text: string, hosts: string[] = appHosts()): Finding[] {
  const found: Finding[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) found.push({ rule: rule.name, excerpt: excerpt(text, match.index, match[0].length) });
  }
  found.push(...offTarget(text, hosts));
  return found;
}

/** The screening category a rule belongs to: the part of its name before the slash. */
export const categoryOf = (rule: string): Screening['category'] => rule.split('/')[0] as Screening['category'];

/** What a screening produced, with the rule findings that were behind it and whether the agent was asked. */
export type Screened = Screening & { findings: Finding[]; screener: 'ran' | 'skipped' | 'not-needed' };

/** A refusal made by the rules alone, without the agent. */
export function refusedByRules(findings: Finding[]): Screened {
  return {
    verdict: 'refuse',
    category: categoryOf(findings[0].rule),
    reasons: findings.map((f) => `${f.rule}: "${f.excerpt}"`),
    question: null,
    findings,
    screener: 'not-needed',
  };
}

const title = { proceed: 'may go on', refuse: 'refused', ask: 'needs an answer' } as const;

/** The report, for people: on the ticket when something was refused or asked, and in the run folder always. */
export function screeningMd(screened: Screened): string {
  const findings = screened.findings.length
    ? `\n### Rule findings\n\n| Rule | Excerpt |\n|---|---|\n${screened.findings.map((f) => `| ${f.rule} | ${f.excerpt.replace(/\|/g, '\\|')} |`).join('\n')}\n`
    : '';
  const next =
    screened.verdict === 'refuse'
      ? '\nNothing was analysed and no test was written. Change the requirement so it describes behaviour of the app to test, remove the `qa-refused` label, and add `qa-pipeline` again.\n'
      : screened.verdict === 'ask'
        ? `\n### Questions that block testing\n\n- ${screened.question ?? 'Is this a request to test the app?'}\n\nAnswer in a comment that starts with \`/qa-answer\`.\n`
        : '';
  return `## Safety screen: ${title[screened.verdict]}

**Verdict:** ${screened.verdict}. **Category:** ${screened.category}. Rules found ${screened.findings.length}; the model screen ${screened.screener === 'ran' ? 'was asked' : 'was not needed or was off'}.

### Reasons

${screened.reasons.map((r) => `- ${r}`).join('\n')}
${findings}${next}`;
}
