/** The page CSS shared by the dashboard pages. */

// The variables and dark mode are the ones lib/history.ts uses, so the pages look like one site.
export const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--tile:#f6f8fa;--accent:#0969da;--bar:#0969da;--ok:#1a7f37;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--tile:#151b23;--accent:#4493f8;--bar:#4493f8;--ok:#3fb950;--bad:#ff7b72}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 12px}
a{color:var(--accent)}
.muted{color:var(--muted);font-size:.875rem;margin:4px 0 0}
.links{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0 20px;font-size:.9rem}
.card{background:var(--tile);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:20px}
.card h2{margin:0 0 12px}
.card h2 small{color:var(--muted);font-size:.8rem;font-weight:400;margin-left:8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:0 0 12px}
.stat{background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:12px 16px}
.stat .label{display:block;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.stat .value{display:block;color:var(--accent);font-size:1.8rem;font-weight:600;overflow-wrap:anywhere}
.stat .note{display:block;color:var(--muted);font-size:.8rem}
.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:.75rem;color:var(--muted);background:var(--line)}
.chip.up{color:var(--ok);background:color-mix(in srgb,var(--ok) 15%,transparent)}
.chip.down{color:var(--bad);background:color-mix(in srgb,var(--bad) 15%,transparent)}
.meterhead{display:flex;justify-content:space-between;gap:12px;font-size:.9rem;margin:8px 0 4px}
.meter{height:10px;background:var(--line);border-radius:5px;overflow:hidden}
.meter>span{display:block;height:100%;background:var(--ok)}
figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}
svg.chart{width:100%;height:auto;display:block}
svg .area{fill:var(--accent);fill-opacity:.12;stroke:none}
svg .line{fill:none;stroke:var(--accent);stroke-width:2}
svg circle{fill:var(--accent)}
svg .axis{stroke:var(--line);stroke-width:1}
svg .target{stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4}
svg .tick{fill:var(--muted);font-size:11px}
label{display:block;font-weight:600;margin-bottom:4px}
input{width:100%;max-width:420px;padding:8px 10px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--muted);border-radius:6px}
.wrap{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:.9rem}
caption{text-align:left;padding:8px 10px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--tile);white-space:nowrap}
th.n,td.n{text-align:right;white-space:nowrap}
tr:last-child td{border-bottom:0}
.ok{color:var(--ok)}.bad{color:var(--bad)}
[hidden]{display:none!important}
@media (max-width:480px){.stats{grid-template-columns:1fr}.card{padding:12px 14px}}
`;
