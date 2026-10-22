import { z } from 'zod';

/**
 * The handoff: what every agent says about its own work when it hands in its answer, next to the answer itself.
 * The answer is for the next stage; the handoff is for the person reading the run. It is how an agent escalates,
 * since nobody is there to ask. A doubt the answer has its own field for (a blocking question, a suspected bug) goes
 * there, because that is what the pipeline acts on, and in `escalations` as well.
 *
 * runAgent adds it to every role's output schema and takes it off again before the stage sees the answer, so no
 * role's own contract changes. A handoff that is missing or malformed is noted in the report, never fatal: the
 * answer is what the pipeline runs on.
 */
export const Handoff = z.object({
  summary: z.string().describe('Two or three sentences: what you were asked, what you did, and what you handed in.'),
  decisions: z
    .array(z.string())
    .describe('The calls you made that a reviewer might question, each with its reason in a few words. Empty when there were none.'),
  escalations: z
    .array(z.string())
    .describe('What a person must look at before trusting this answer: a guess you had to make, something you could not check, a risk outside your job. Empty when there is nothing.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('How far you would stake the answer on being right.'),
  confidenceReason: z.string().describe('One sentence: why that confidence.'),
});
export type Handoff = z.infer<typeof Handoff>;

/** What the agent is told about the handoff, appended to its ground rules. */
export const HANDOFF_RULES = `
# Your handoff

Your answer has a \`handoff\` field next to everything else. Fill it in last, honestly, for the person who reads this
run: a short summary of what you did, the calls you made that someone might question, and what a person must check
before trusting your answer. Nobody can answer a question while you work, so a concern goes in writing. When your
answer has its own field for it (a blocking question, a suspected bug, a case not automated), put it there first:
that field is what the pipeline acts on. Then name it in the handoff's escalations too. "Low" confidence with a clear
reason is more useful than "high" that is not earned.
`;

/** The role's schema with the handoff added, when the schema is an object; any other shape is left as it is. */
export function withHandoff(schema: z.ZodType): z.ZodType {
  // Optional in the schema the CLI enforces, so an agent that forgets it still hands in its answer.
  return schema instanceof z.ZodObject ? schema.extend({ handoff: Handoff.optional() }) : schema;
}

/** The handoff in an agent's raw answer, or null when there is none or it does not match. */
export function handoffIn(output: unknown): Handoff | null {
  if (!output || typeof output !== 'object') return null;
  const parsed = Handoff.safeParse((output as { handoff?: unknown }).handoff);
  return parsed.success ? parsed.data : null;
}
