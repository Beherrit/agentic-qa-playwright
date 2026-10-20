import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PKG_ROOT } from '../pkg.ts';
import { launch, visit } from './browser.ts';
import { loadLighthouse, runLighthouse } from './lighthouse.ts';
import { Budgets } from './schema.ts';
import { judgeBudgets, medianMeasure, UNITS } from './stats.ts';

/**
 * Proof the gate measures what it claims: two pages served from this machine, one clean and one with a slow
 * render-blocking script and an image that shifts the layout when it loads. The clean page must pass the default
 * budgets; the broken one must fail CLS and TBT, and Lighthouse must name the planted script and the planted image.
 * Nothing here is mocked: the same browser, the same Lighthouse, the same judging as a real run.
 */

const FIXTURES = path.join(PKG_ROOT, 'agents', 'evals', 'fixtures', 'perf');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

/** Serves the fixture folder. The slow script is held for a while before it is answered, as a slow CDN would. */
function serve(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((request, response) => {
    const file = path.join(FIXTURES, path.normalize(request.url?.split('?')[0] ?? '/').replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    const send = () => response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(file));
    // The planted page's script is answered late, so it blocks rendering; its banner too, so the text paints first.
    if (file.endsWith('slow.js')) setTimeout(send, 1_500);
    else if (request.url?.includes('late')) setTimeout(send, 400);
    else send();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

type Check = { name: string; ok: boolean; detail: string };

export async function prove(_root: string, runs = 3): Promise<number> {
  const lh = await loadLighthouse();
  const budgets = Budgets.parse({});
  const site = await serve();
  const browser = await launch(null, '', site.url);
  const checks: Check[] = [];
  try {
    for (const page of ['clean', 'planted'] as const) {
      const url = `${site.url}/${page}.html`;
      const seen = await visit(browser.page, url, 'mobile');
      const results = [];
      for (let i = 0; i < runs; i += 1) results.push(await runLighthouse(url, 'mobile', browser.port, lh));
      const measure = medianMeasure(results.map((r) => r.summary.measure));
      const verdicts = judgeBudgets(measure, budgets);
      const diag = results[0].summary.diagnostics;
      console.log(`${page}: score ${UNITS.performance(measure.performance)}, LCP ${UNITS.lcpMs(measure.lcpMs)}, CLS ${UNITS.cls(measure.cls)}, TBT ${UNITS.tbtMs(measure.tbtMs)}; ${verdicts.length} verdict(s)`);
      if (page === 'clean') {
        checks.push({ name: 'the clean page passes every default budget', ok: verdicts.length === 0, detail: verdicts.map((v) => v.text).join('; ') || 'no verdicts' });
        checks.push({ name: 'the clean page has no console errors', ok: seen.consoleErrors.length === 0, detail: seen.consoleErrors.join(' / ') || 'none' });
      } else {
        const metrics = new Set(verdicts.map((v) => v.metric));
        checks.push({ name: 'the planted page fails CLS', ok: metrics.has('cls'), detail: UNITS.cls(measure.cls) });
        checks.push({ name: 'the planted page fails TBT or the score', ok: metrics.has('tbtMs') || metrics.has('performance'), detail: `TBT ${UNITS.tbtMs(measure.tbtMs)}, score ${measure.performance}` });
        checks.push({ name: 'Lighthouse names the planted render-blocking script', ok: diag.renderBlocking.some((r) => r.url.endsWith('slow.js')), detail: diag.renderBlocking.map((r) => r.url).join(', ') || 'none listed' });
        checks.push({ name: 'Lighthouse names the element that shifted', ok: diag.layoutShifts.length > 0, detail: diag.layoutShifts.map((s) => `${s.element} (${s.score.toFixed(3)})`).join(', ') || 'none listed' });
        checks.push({ name: 'Playwright caught the planted console error', ok: seen.consoleErrors.some((e) => e.includes('planted')), detail: seen.consoleErrors.join(' / ') || 'none' });
      }
    }
  } finally {
    await browser.close();
    site.close();
  }
  console.log('');
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} of ${checks.length} checks failed.` : `\nAll ${checks.length} checks passed.`);
  return failed ? 1 : 0;
}
