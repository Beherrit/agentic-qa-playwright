import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the engine itself lives: its prompts, templates and evaluation cases. In this repository it is also the
 * project under test. Installed as a dependency it is node_modules/agentic-qa-playwright, and the project is
 * found separately (see paths.ts).
 */
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
