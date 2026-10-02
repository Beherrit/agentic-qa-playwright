import fs from 'node:fs';
import path from 'node:path';
import { inRepo, specTitles, type Repo } from './technical.ts';

/** What the checks may ask about a checkout. Only paths inside it are ever read. */
export function repoAt(root: string): Repo {
  const fileExists = (file: string): boolean => inRepo(file) && fs.existsSync(path.join(root, file));
  return {
    fileExists,
    titlesIn: (file) => (file.endsWith('.spec.ts') && fileExists(file) ? specTitles(fs.readFileSync(path.join(root, file), 'utf8')) : null),
  };
}
