import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaChart, card, count, dateText, delta, filterScript, hours, linkCell, meter, pageShell, pct, relLink, secs, stat, table } from '../lib/history/html.ts';

describe('formatters', () => {
  it('pct shows one decimal and a percent sign, and a dash for null', () => {
    assert.equal(pct(96.2), '96.2%');
    assert.equal(pct(0), '0.0%');
    assert.equal(pct(100), '100.0%');
    assert.equal(pct(null), '-');
  });

  it('secs shows seconds with one decimal under a minute', () => {
    assert.equal(secs(0), '0.0s');
    assert.equal(secs(16_000), '16.0s');
    assert.equal(secs(59_940), '59.9s');
  });

  it('secs never shows 60.0s: 59,950 ms rounds up into a whole minute', () => {
    assert.equal(secs(59_950), '1m 0s');
  });

  it('secs shows minutes and seconds from a minute up, and a dash for null', () => {
    assert.equal(secs(61_000), '1m 1s');
    assert.equal(secs(83_000), '1m 23s');
    assert.equal(secs(null), '-');
  });

  it('hours shows one decimal and hrs from one hour up', () => {
    assert.equal(hours(80_280_000), '22.3 hrs');
    assert.equal(hours(3_600_000), '1.0 hrs');
  });
  it('hours shows minutes with one decimal under one hour', () => {
    assert.equal(hours(738_000), '12.3 min');
    assert.equal(hours(0), '0.0 min');
  });

  it('count puts thousands separators in', () => {
    assert.equal(count(1_234_567), '1,234,567');
    assert.equal(count(14_380), '14,380');
    assert.equal(count(0), '0');
    assert.equal(count(999), '999');
  });

  it('dateText gives the UTC date, and a dash for something that is not a date', () => {
    assert.equal(dateText('2026-10-27T23:59:59Z'), '2026-10-27');
    assert.equal(dateText('nonsense'), '-');
  });

  it('delta carries the sign, one decimal and what it is measured against', () => {
    assert.equal(delta(96.6, 96.2), '+0.4 pts vs 30d avg');
    assert.equal(delta(96.0, 96.2), '-0.2 pts vs 30d avg');
    assert.equal(delta(96.2, 96.2), '+0.0 pts vs 30d avg');
    assert.equal(delta(97.5, 96.3, 'previous run'), '+1.2 pts vs previous run');
  });

  it('delta is empty when either side is missing', () => {
    assert.equal(delta(null, 96.2), '');
    assert.equal(delta(96.2, null), '');
  });
});

describe('table', () => {
  it('escapes a script in a plain cell and in a column heading', () => {
    const html = table(['<b>Name</b>'], [['<script>alert(1)</script>']]);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  it('passes an html cell through untouched', () => {
    const html = table(['Run'], [[{ html: '<a href="x/">ok</a>' }]]);
    assert.ok(html.includes('<td><a href="x/">ok</a></td>'));
  });

  it('numbers the rows with data-i and right-aligns the numeric columns', () => {
    const html = table(['A', 'B'], [['a1', '1'], ['a2', '2']], { id: 't', numeric: [1] });
    assert.ok(html.includes('<table id="t">'));
    assert.ok(html.includes('<tr data-i="0"><td>a1</td><td class="n">1</td></tr>'));
    assert.ok(html.includes('<tr data-i="1">'));
    assert.ok(html.includes('<th scope="col" class="n">B</th>'));
  });

  it('shows the empty message in one row spanning every column when there are no rows', () => {
    const html = table(['A', 'B', 'C'], [], { empty: 'Nothing here.' });
    assert.ok(html.includes('<td colspan="3">Nothing here.</td>'));
    assert.ok(!html.includes('data-i'));
  });
});

describe('links', () => {
  it('linkCell links a GitHub URL and gives a dash for anything else', () => {
    assert.equal(linkCell('https://github.com/acme/shop/actions/runs/1', 'run'), '<a href="https://github.com/acme/shop/actions/runs/1" rel="noopener noreferrer">run</a>');
    assert.equal(linkCell('javascript:alert(1)', 'run'), '-');
    assert.equal(linkCell('https://evil.example/x', 'run'), '-');
  });

  it('relLink links a path inside the site and drops anything with a scheme or a query', () => {
    assert.equal(relLink('projects/swag-labs/', 'Swag'), '<a href="projects/swag-labs/">Swag</a>');
    assert.equal(relLink('../../', 'Home'), '<a href="../../">Home</a>');
    assert.equal(relLink('javascript:alert(1)', '<x>'), '&lt;x&gt;');
    assert.equal(relLink('//evil.example/', 'x'), 'x');
    assert.equal(relLink('a/?q=1', 'x'), 'x');
  });
});

describe('areaChart', () => {
  const format = (n: number): string => `${n}%`;

  it('says No data yet. when every point is null, and draws no svg', () => {
    const html = areaChart({ title: 'Trend', points: [{ label: 'a', value: null }, { label: 'b', value: null }], format, yLabel: 'Pass rate' });
    assert.ok(html.includes('No data yet.'));
    assert.ok(!html.includes('<svg'));
  });

  it('says No data yet. for no points at all', () => {
    assert.ok(areaChart({ title: 'Trend', points: [], format, yLabel: 'y' }).includes('No data yet.'));
  });

  it('leaves a gap for a null point: two runs in the line and no dot for the gap', () => {
    const points = [{ label: 'a', value: 50 }, { label: 'b', value: null }, { label: 'c', value: 100 }, { label: 'd', value: 100 }];
    const html = areaChart({ title: 'Trend', points, max: 100, format, yLabel: 'y' });
    const line = /<path class="line" d="([^"]*)"/.exec(html)?.[1] ?? '';
    assert.equal(line.match(/M/g)?.length, 2);
    assert.equal(html.match(/<circle/g)?.length, 3);
    assert.ok(!html.includes('b: '));
  });

  it('puts a tooltip on every present point', () => {
    const html = areaChart({ title: 'Trend', points: [{ label: '2026-10-01', value: 90.5 }], format: (n) => `${n}%`, yLabel: 'y' });
    assert.ok(html.includes('<title>2026-10-01: 90.5%</title>'));
  });

  it('describes itself with the title, the number of points and the latest value', () => {
    const html = areaChart({ title: 'Pass rate', points: [{ label: 'a', value: 90 }, { label: 'b', value: 95 }], format, yLabel: 'y' });
    assert.ok(html.includes('aria-label="Pass rate, 2 points, latest 95%"'));
  });

  it('draws the target line with its label only when a target is given', () => {
    const points = [{ label: 'a', value: 90 }, { label: 'b', value: 95 }];
    assert.ok(areaChart({ title: 't', points, max: 100, target: 95, format, yLabel: 'y' }).includes('target 95%'));
    assert.ok(!areaChart({ title: 't', points, max: 100, format, yLabel: 'y' }).includes('class="target"'));
  });

  it('labels the y axis at 0, half and max, and the x axis at first, middle and last', () => {
    const points = ['a', 'b', 'c', 'd', 'e'].map((label) => ({ label, value: 10 }));
    const html = areaChart({ title: 't', points, max: 100, format, yLabel: 'Rate' });
    for (const tick of ['>0%<', '>50%<', '>100%<', '>Rate<']) assert.ok(html.includes(tick), tick);
    for (const x of ['>a<', '>c<', '>e<']) assert.ok(html.includes(x), x);
    assert.ok(!html.includes('>b<') && !html.includes('>d<'));
  });

  it('escapes a label with markup in it', () => {
    const html = areaChart({ title: 't', points: [{ label: '<img>', value: 1 }], format, yLabel: 'y' });
    assert.ok(!html.includes('<img>'));
    assert.ok(html.includes('&lt;img&gt;'));
  });
});

describe('pageShell', () => {
  const shell = (over: Partial<Parameters<typeof pageShell>[0]> = {}): string =>
    pageShell({ title: 'T', intro: 'I', nav: [], body: '<p>body</p>', ...over });

  it('escapes the title, the intro and the nav text', () => {
    const html = shell({ title: '<script>x</script>', intro: 'a & b', nav: [{ href: '../', text: '<i>Back</i>' }] });
    assert.ok(!html.includes('<script>x'));
    assert.ok(html.includes('<title>&lt;script&gt;x&lt;/script&gt;</title>'));
    assert.ok(html.includes('a &amp; b'));
    assert.ok(html.includes('&lt;i&gt;Back&lt;/i&gt;'));
  });

  it('escapes < in the JSON block as \\u003c and the data reads back whole', () => {
    const data = ['</script><b>', 'plain'];
    const html = shell({ json: { id: 'rows-data', data } });
    const raw = /<script type="application\/json" id="rows-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    assert.ok(raw.includes('\\u003c/script>'));
    assert.ok(!raw.includes('<'));
    assert.deepEqual(JSON.parse(raw), data);
  });

  it('writes one JSON block per entry when given several', () => {
    const html = shell({ json: [{ id: 'a-data', data: [1] }, { id: 'b-data', data: [2] }] });
    assert.ok(html.includes('id="a-data"') && html.includes('id="b-data"'));
  });

  it('is a full document with the page body, the nav and the script', () => {
    const html = shell({ nav: [{ href: 'pipeline/', text: 'Pipeline' }], script: 'var x=1;' });
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('<meta name="viewport"'));
    assert.ok(html.includes('<a href="pipeline/">Pipeline</a>'));
    assert.ok(html.includes('<p>body</p>'));
    assert.ok(html.includes('<script>var x=1;</script>'));
  });

  it('has no external scripts or stylesheets', () => {
    assert.ok(!/<script[^>]*\ssrc=|<link[^>]*stylesheet/.test(shell()));
  });
});

describe('stat, card, meter, filterScript', () => {
  it('stat escapes its text and shows the chip with its direction', () => {
    const html = stat('<L>', '96.2%', 'note & more', { text: '+0.4 pts', dir: 'up' });
    assert.ok(html.includes('&lt;L&gt;') && html.includes('note &amp; more'));
    assert.ok(html.includes('<span class="chip up">+0.4 pts</span>'));
    assert.ok(stat('a', 'b', undefined, { text: '0', dir: 'flat' }).includes('<span class="chip">0</span>'));
    assert.ok(!stat('a', 'b').includes('class="note"'));
  });

  it('card escapes the title and caption but not the body', () => {
    const html = card('A & B', '<c>', '<p>kept</p>');
    assert.ok(html.includes('A &amp; B') && html.includes('&lt;c&gt;') && html.includes('<p>kept</p>'));
  });

  it('meter sets the width from the fraction, clamps it, and reads null as empty', () => {
    assert.ok(meter('Signal', 0.25, '25.0%').includes('width:25.0%'));
    assert.ok(meter('Signal', 1.5, 'x').includes('width:100.0%'));
    assert.ok(meter('Signal', null, '-').includes('width:0.0%'));
  });

  it('filterScript reads the table data block and the given ids', () => {
    const js = filterScript('health', 'health-filter', 'health-count', 'tests');
    for (const part of ['"health-data"', '"#health tbody tr[data-i]"', '"health-count"', '"health-filter"', '"tests"']) assert.ok(js.includes(part), part);
    assert.ok(!js.includes('innerHTML'));
  });
});
