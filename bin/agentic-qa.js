#!/usr/bin/env node
// The engine's command line. Its code is TypeScript, run as it is through tsx: Node's own TypeScript support
// refuses files inside node_modules, which is where the engine lives once a project has installed it.
import { register } from 'tsx/esm/api';

// Node warns about experimental features on every start; that one warning is dropped, every other still shows.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning.stack ?? warning.message);
});

register();
await import('../agents/cli.ts');
