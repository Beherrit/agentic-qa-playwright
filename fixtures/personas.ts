/**
 * Swag Labs ships a fixed set of demo accounts and prints them on its own login page.
 * Each one misbehaves in a different way on purpose, which makes them useful as test personas.
 */
export const PASSWORD = process.env.SAUCE_PASSWORD ?? 'secret_sauce';

export const personas = {
  standard: 'standard_user',
  lockedOut: 'locked_out_user',
  problem: 'problem_user',
  slow: 'performance_glitch_user',
  error: 'error_user',
  visual: 'visual_user',
} as const;

/** The account the suite signs in with. Set SAUCE_USER to run the same tests as another persona. */
export const defaultUser: string = process.env.SAUCE_USER || personas.standard;
