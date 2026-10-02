import type { Health, Requirements, Strategy } from './schemas.ts';

/** Scores the plan from facts, not from the planner's opinion of its own work. */
export function planHealth(req: Requirements, strategy: Pick<Strategy, 'cases' | 'checklist' | 'checklistItems'>): Health {
  const share = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);
  const covered = new Set(strategy.cases.flatMap((c) => c.criteria));

  const criteriaCovered = req.criteria.filter((c) => covered.has(c.id));
  const unhappy = req.criteria.filter((c) => c.kind !== 'happy');
  const unhappyCovered = unhappy.filter((c) => covered.has(c.id));

  const weight = (id: string): number => (strategy.checklistItems.find((item) => item.id === id)?.weight === 'must' ? 2 : 1);
  const checklistTotal = strategy.checklist.reduce((sum, item) => sum + weight(item.id), 0);
  const checklistMet = strategy.checklist.filter((item) => item.coveredBy.length).reduce((sum, item) => sum + weight(item.id), 0);

  const automated = strategy.cases.filter((c) => c.layer !== 'manual');

  const parts = [
    {
      name: 'Acceptance criteria covered',
      weight: 40,
      value: share(criteriaCovered.length, req.criteria.length),
      detail: `${criteriaCovered.length} of ${req.criteria.length} criteria have a test case`,
    },
    {
      name: "Critic's checklist met",
      weight: 30,
      value: share(checklistMet, checklistTotal),
      detail: `${strategy.checklist.filter((item) => item.coveredBy.length).length} of ${strategy.checklist.length} items covered (must items count double)`,
    },
    {
      // A requirement with no negative or edge criteria has not been analysed properly, so it earns nothing here.
      name: 'Negative and edge criteria covered',
      weight: 20,
      value: unhappy.length === 0 ? 0 : share(unhappyCovered.length, unhappy.length),
      detail: unhappy.length === 0 ? 'the requirement has no negative or edge criteria' : `${unhappyCovered.length} of ${unhappy.length}`,
    },
    {
      name: 'Automated rather than manual',
      weight: 10,
      value: share(automated.length, strategy.cases.length),
      detail: `${automated.length} of ${strategy.cases.length} cases`,
    },
  ];
  return { score: Math.round(parts.reduce((sum, part) => sum + part.weight * part.value, 0)), parts };
}
