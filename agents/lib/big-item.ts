/**
 * A big item: a requirement large or risky enough that a person should read the plan before any test is written,
 * whatever the configuration says about starting the tests by themselves. The analysis says so on the ticket and in
 * the run report. Pure: the settings are passed in.
 */
export type BigItemSettings = { criteria: number; highRisk: boolean };

/** Why the requirement is a big item, or null when it is not. */
export function bigItem(req: { criteria: unknown[]; risk: string } | null, settings: BigItemSettings): string | null {
  if (!req) return null;
  const why: string[] = [];
  if (req.criteria.length >= settings.criteria) why.push(`${req.criteria.length} criteria (${settings.criteria} or more)`);
  if (settings.highRisk && req.risk === 'high') why.push('high ticket risk');
  return why.length ? why.join(' and ') : null;
}
