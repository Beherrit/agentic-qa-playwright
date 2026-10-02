#!/usr/bin/env node
// The engine's command line, run on Node's own TypeScript support (22.18 or newer). Node calls that support
// experimental and says so on every start; that one warning is dropped, every other warning still shows.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning.stack ?? warning.message);
});
await import('../agents/cli.ts');
