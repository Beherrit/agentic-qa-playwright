import { chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FormFactor } from './schema.ts';

/**
 * The browser the gate drives: one persistent Chromium with a debugging port, so Playwright and Lighthouse share
 * it. Playwright signs in and looks at each page the way a user would (console, failed requests, a screenshot);
 * Lighthouse attaches to the same browser and measures. The sign-in is the project's own module (perf.setup).
 */

export type Visit = {
  consoleErrors: string[];
  failedRequests: { url: string; status: number | string }[];
  pageErrors: string[];
  /** The final address, after redirects. */
  url: string;
  screenshot: Buffer | null;
};

export type SetupFn = (page: Page, persona: string) => Promise<void>;
export type PerfBrowser = { context: BrowserContext; page: Page; port: number; close: () => Promise<void> };

const VIEWPORTS: Record<FormFactor, { width: number; height: number }> = { mobile: { width: 412, height: 823 }, desktop: { width: 1350, height: 940 } };
const MAX_LIST = 20;
const SETTLE_MS = 1_000;

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The project's sign-in module, when the config names one. */
export async function loadSetup(root: string, file: string | null): Promise<SetupFn | null> {
  if (!file) return null;
  const full = path.resolve(root, file);
  if (!fs.existsSync(full)) throw new Error(`perf.setup names ${file}, which does not exist.`);
  const mod = (await import(pathToFileURL(full).href)) as { default?: unknown };
  if (typeof mod.default !== 'function') throw new Error(`${file} must export default an async (page, persona) => void.`);
  return mod.default as SetupFn;
}

/**
 * Launches the browser and signs in. A persistent context is the browser's default one, which is the context
 * Lighthouse's new tabs open in, so the cookies the sign-in sets are the cookies Lighthouse sends.
 */
export async function launch(setup: SetupFn | null, persona: string, baseURL: string): Promise<PerfBrowser> {
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-perf-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [`--remote-debugging-port=${port}`],
    viewport: VIEWPORTS.desktop,
    // So the setup module can `page.goto('/')` the way the suite's page objects do.
    baseURL,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  if (setup) {
    console.log(`Signing in${persona ? ` as ${persona}` : ''} (perf.setup)`);
    await setup(page, persona);
  }
  const close = async () => {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  return { context, page, port, close };
}

/** Loads one page as a user would and notes what went wrong on the way, plus a full-page screenshot. */
export async function visit(page: Page, url: string, formFactor: FormFactor): Promise<Visit> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Visit['failedRequests'] = [];
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error' && consoleErrors.length < MAX_LIST) consoleErrors.push(message.text().slice(0, 300));
  };
  const onPageError = (error: Error) => pageErrors.length < MAX_LIST && pageErrors.push(error.message.slice(0, 300));
  const onResponse = (response: { status(): number; url(): string }) => {
    if (response.status() >= 400 && failedRequests.length < MAX_LIST) failedRequests.push({ url: response.url().slice(0, 300), status: response.status() });
  };
  const onFailed = (request: { url(): string; failure(): { errorText: string } | null }) => {
    if (failedRequests.length < MAX_LIST) failedRequests.push({ url: request.url().slice(0, 300), status: request.failure()?.errorText ?? 'failed' });
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  let screenshot: Buffer | null = null;
  try {
    await page.setViewportSize(VIEWPORTS[formFactor]);
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    // Pages do things after load: deferred images, analytics, a banner. A second of settling catches their errors.
    await page.waitForTimeout(SETTLE_MS);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  } catch (error) {
    pageErrors.push(`navigation: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onFailed);
  }
  return { consoleErrors, pageErrors, failedRequests, url: page.url(), screenshot };
}

/**
 * The share of pixels that differ between two PNGs, 0 to 1, computed by the browser itself on a canvas, so the
 * gate needs no image library. Images of different sizes are compared over the larger box; the missing part counts
 * as different. Null when either image cannot be decoded.
 */
export async function pixelDiff(page: Page, before: Buffer, after: Buffer): Promise<number | null> {
  const toUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
  // No named inner functions here: tsx wraps those in a `__name` helper that does not exist inside the page.
  return page.evaluate(
    async (sources) => {
      const images = await Promise.all(
        sources.map(
          (src) =>
            new Promise<HTMLImageElement | null>((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => resolve(null);
              img.src = src;
            }),
        ),
      );
      const [x, y] = images;
      if (!x || !y) return null;
      const w = Math.max(x.width, y.width);
      const h = Math.max(x.height, y.height);
      if (!w || !h) return null;
      const [p, q] = [x, y].map((img) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      });
      let different = 0;
      for (let i = 0; i < p.length; i += 4) {
        // A small tolerance per channel absorbs anti-aliasing; a real change moves a channel much further.
        if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24 || Math.abs(p[i + 3] - q[i + 3]) > 24) different += 1;
      }
      return different / (w * h);
    },
    [toUrl(before), toUrl(after)] as const,
  );
}
