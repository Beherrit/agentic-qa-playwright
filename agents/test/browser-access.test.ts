import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appOrigins, browserAccess, browserArgs, browserTools } from '../lib/agent.ts';

const browser = { allowedOrigins: [], blockedOrigins: [], webmcp: false, actionTimeoutMs: 5000, navigationTimeoutMs: 30000 };
const has = (tools: string[], name: string) => tools.includes(`mcp__playwright__${name}`);

describe('browser access levels', () => {
  it('look reads and clicks, test adds locators and live checks, break adds routes and storage', () => {
    const look = browserTools('look');
    const test = browserTools('test');
    const brk = browserTools('break');
    assert.ok(has(look, 'browser_snapshot') && has(look, 'browser_console_messages') && has(look, 'browser_network_requests'));
    assert.ok(!has(look, 'browser_generate_locator') && !has(look, 'browser_route'));
    assert.ok(has(test, 'browser_generate_locator') && has(test, 'browser_verify_element_visible'));
    assert.ok(!has(test, 'browser_route') && !has(test, 'browser_cookie_set'));
    assert.ok(has(brk, 'browser_route') && has(brk, 'browser_network_state_set') && has(brk, 'browser_localstorage_set'));
    assert.ok(!has(brk, 'browser_verify_value'));
  });

  it('no level evaluates scripts, uploads files or saves PDFs', () => {
    for (const access of ['look', 'test', 'break'] as const) {
      for (const tool of ['browser_evaluate', 'browser_run_code_unsafe', 'browser_file_upload', 'browser_pdf_save', 'browser_start_recording']) {
        assert.ok(!has(browserTools(access), tool), `${access} must not have ${tool}`);
      }
    }
  });

  it('true means look, and nothing means no browser', () => {
    assert.equal(browserAccess(true), 'look');
    assert.equal(browserAccess('break'), 'break');
    assert.equal(browserAccess(undefined), null);
    assert.equal(browserAccess(false), null);
  });

  it('the server gets the capabilities a level needs, WebMCP off, and code only for the role that writes it', () => {
    const look = browserArgs('look', browser, ['https://app.example']);
    assert.ok(!look.includes('--caps'));
    assert.ok(look.includes('--no-webmcp'));
    assert.deepEqual(look.slice(look.indexOf('--codegen'), look.indexOf('--codegen') + 2), ['--codegen', 'none']);
    assert.ok(!look.includes('--allowed-origins'), 'origins are not restricted unless the project says so');

    const test = browserArgs('test', browser, []);
    assert.deepEqual(test.slice(test.indexOf('--caps'), test.indexOf('--caps') + 2), ['--caps', 'testing']);
    assert.ok(test.includes('typescript'));

    const brk = browserArgs('break', { ...browser, webmcp: true, allowedOrigins: ['https://cdn.example'], blockedOrigins: ['https://analytics.example'] }, ['https://app.example']);
    assert.deepEqual(brk.slice(brk.indexOf('--caps'), brk.indexOf('--caps') + 2), ['--caps', 'network,storage']);
    assert.ok(!brk.includes('--no-webmcp'));
    assert.equal(brk[brk.indexOf('--allowed-origins') + 1], 'https://app.example;https://cdn.example');
    assert.equal(brk[brk.indexOf('--blocked-origins') + 1], 'https://analytics.example');
  });

  it("the app's origins come from the config, and a templated preview URL adds none", () => {
    assert.deepEqual(appOrigins({ baseUrl: 'https://www.saucedemo.com/inventory.html' }), ['https://www.saucedemo.com']);
    assert.deepEqual(appOrigins({ baseUrl: 'https://app.example', previewUrl: 'https://pr-{number}.preview.example' }), ['https://app.example']);
    assert.deepEqual(appOrigins({ baseUrl: 'https://app.example', previewUrl: 'https://preview.example' }), ['https://app.example', 'https://preview.example']);
    assert.deepEqual(appOrigins({ baseUrl: 'not a url' }), []);
  });
});
