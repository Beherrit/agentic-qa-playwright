/**
 * The shapes the migration tool passes around. The inventory describes the old project, the plan orders the work
 * into waves, and the waves are what the agents convert one at a time.
 */

export type Language = 'python' | 'java' | 'csharp' | 'javascript' | 'typescript' | 'ruby' | 'unknown';
export type FileKind = 'config' | 'util' | 'page' | 'test' | 'other';

/**
 * Things in the old suite that do not survive the move as written: state shared between tests, a required order, fixed
 * waits, retry loops and a Selenium Grid hub. Each one changes how the converted tests must be built.
 */
export const RISKS = ['shared-driver', 'ordered', 'static-state', 'sleep', 'implicit-wait', 'retry-loop', 'grid'] as const;
export type Risk = (typeof RISKS)[number];

export type SourceTest = { name: string; line: number; assertions: number };

export type SourceFile = {
  /** Relative to the source root, forward slashes. */
  path: string;
  kind: FileKind;
  language: Language;
  lines: number;
  tests: SourceTest[];
  assertions: number;
  /** Module names or relative paths, as the file wrote them. */
  imports: string[];
  /** The name or the content mentions login, sign in or auth. */
  login: boolean;
  /** Which risks the file shows, once each. */
  risks: Risk[];
};

export type Framework = 'pytest' | 'unittest' | 'junit' | 'testng' | 'nunit' | 'mstest' | 'mocha' | 'jest' | 'rspec' | 'unknown';

export type Inventory = {
  root: string;
  language: Language;
  framework: Framework;
  files: SourceFile[];
  configFiles: string[];
  /** Names of util and page functions that assert; a test calling one makes those assertions too. */
  assertionHelpers: string[];
  /** `risks` is how many files show each risk. */
  totals: { tests: number; assertions: number; files: number; risks: Record<Risk, number> };
};

export type WaveKind = 'settings' | 'utils' | 'login' | 'suite';

export type Wave = {
  id: string;
  kind: WaveKind;
  name: string;
  sources: string[];
  tests: number;
  assertions: number;
  /** The old tests this wave covers when a file was split into several waves; unset when it covers them all. */
  names?: string[];
  /** The union of the risks of its source files. */
  risks?: Risk[];
};

export type MigrationPlan = { language: Language; framework: Framework; waves: Wave[] };
