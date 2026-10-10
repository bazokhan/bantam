// Server-rendered HTML for the admin UI. Plain string templates — no client
// framework, no client secrets. CSS lives in `css()` as a token-driven
// design system. Every dynamic string passes through `escapeHtml` even
// though the data sources are trusted.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Design tokens: dark, instrument-style palette tuned for an operator
// dashboard. Accent is a measured teal (not acid-green or vermilion) so the
// UI reads as a control surface, not a marketing page.
function css(): string {
  return `
:root {
  color-scheme: dark;
  --bg: #0e1620;
  --surface: #15212e;
  --surface-2: #1b2a3a;
  --border: #233446;
  --border-strong: #324a64;
  --fg: #e6edf4;
  --fg-strong: #ffffff;
  --muted: #93a6bb;
  --accent: #5bd9c5;
  --accent-ink: #08221f;
  --ok: #5bd98a;
  --warn: #e8b860;
  --danger: #f27373;
  --danger-bg: rgba(242, 115, 115, 0.12);
  --code-bg: #0a131c;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow-focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: 4px; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-sm);
}
h1, h2, h3, h4 { margin: 0; font-weight: 600; letter-spacing: -0.01em; color: var(--fg-strong); }
h1 { font-size: 1.6rem; line-height: 1.2; }
h2 { font-size: 1.05rem; line-height: 1.3; }
h3 { font-size: 0.95rem; line-height: 1.3; color: var(--muted); font-weight: 500; text-transform: none; }
small, .muted { color: var(--muted); font-size: 0.85rem; }
code, kbd, samp { font-family: var(--font-mono); font-size: 0.85em; background: var(--code-bg); padding: 0.1rem 0.35rem; border-radius: 4px; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.5rem 0; }

/* ─── Shell ─────────────────────────────────────────────────────────────── */
.shell { max-width: 72rem; margin: 0 auto; padding: 1rem clamp(1rem, 4vw, 2rem) 4rem; }
.shell > main { padding-top: 1.5rem; }
.skip {
  position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden;
}
.skip:focus { position: static; width: auto; height: auto; padding: 0.5rem 1rem; background: var(--accent); color: var(--accent-ink); }

/* ─── Header / nav ──────────────────────────────────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in oklab, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  padding: 0.6rem clamp(1rem, 4vw, 2rem);
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
}
.topbar .brand {
  display: flex; align-items: center; gap: 0.5rem;
  font-weight: 600; color: var(--fg-strong); letter-spacing: -0.01em;
}
.topbar .brand .mark {
  width: 1.4rem; height: 1.4rem; border-radius: 4px;
  background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 50%, #2b8a9b));
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent-ink); font-family: var(--font-mono); font-weight: 700; font-size: 0.75rem;
}
.topbar nav { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-left: auto; }
.topbar nav a {
  color: var(--muted); padding: 0.45rem 0.7rem; border-radius: var(--radius-sm); font-size: 0.9rem;
}
.topbar nav a:hover { color: var(--fg); background: var(--surface); text-decoration: none; }
.topbar nav a.active {
  color: var(--fg-strong); background: var(--surface-2);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.topbar .meta { font-size: 0.85rem; color: var(--muted); margin-left: auto; }

/* ─── Page header ───────────────────────────────────────────────────────── */
.page-head { display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
.page-head > div:first-child { flex: 1 1 auto; min-width: 0; }
.page-head .subtitle { color: var(--muted); margin-top: 0.25rem; font-size: 0.9rem; }
.page-head .actions { flex: 0 0 auto; display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* ─── Cards / sections ──────────────────────────────────────────────────── */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem clamp(1rem, 2.5vw, 1.5rem); margin: 1rem 0;
}
.card.compact { padding: 0.85rem 1rem; }
.card h2 { margin-bottom: 0.75rem; }
.card.stack > * + * { margin-top: 0.75rem; }
.card-grid {
  display: grid; gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

/* ─── Buttons ───────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
  font-family: inherit; font-size: 0.9rem; font-weight: 500;
  padding: 0.55rem 0.95rem; border-radius: var(--radius-sm); border: 1px solid transparent;
  background: transparent; color: var(--fg); cursor: pointer; text-decoration: none;
  min-height: 2.25rem;
}
.btn:disabled, .btn[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.btn.primary:hover { background: color-mix(in oklab, var(--accent) 85%, white 15%); text-decoration: none; }
.btn.secondary { border-color: var(--border-strong); color: var(--fg); background: var(--surface); }
.btn.secondary:hover { border-color: var(--accent); color: var(--fg-strong); text-decoration: none; }
.btn.danger { background: var(--danger-bg); color: var(--danger); border-color: color-mix(in oklab, var(--danger) 35%, transparent); }
.btn.danger:hover { background: color-mix(in oklab, var(--danger-bg) 60%, var(--danger) 12%); text-decoration: none; }
.btn.ghost { color: var(--muted); }
.btn.ghost:hover { color: var(--fg); background: var(--surface); text-decoration: none; }
.btn.small { padding: 0.35rem 0.65rem; min-height: 1.85rem; font-size: 0.85rem; }
.btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.btn-row > * { margin: 0; }

/* ─── Tags / badges ─────────────────────────────────────────────────────── */
.tag {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.78rem; font-weight: 500;
  border: 1px solid transparent; line-height: 1.4;
}
.tag.ok { background: rgba(91, 217, 138, 0.12); color: var(--ok); border-color: rgba(91, 217, 138, 0.3); }
.tag.warn { background: rgba(232, 184, 96, 0.12); color: var(--warn); border-color: rgba(232, 184, 96, 0.3); }
.tag.bad { background: var(--danger-bg); color: var(--danger); border-color: rgba(242, 115, 115, 0.3); }
.tag.neutral { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
.tag .dot { width: 0.4rem; height: 0.4rem; border-radius: 999px; background: currentColor; }

/* ─── Banner / inline message ──────────────────────────────────────────── */
.banner {
  border: 1px solid var(--border); border-left: 3px solid var(--accent);
  background: var(--surface); border-radius: var(--radius-sm);
  padding: 0.85rem 1rem; margin: 1rem 0;
}
.banner.ok { border-left-color: var(--ok); }
.banner.warn { border-left-color: var(--warn); }
.banner.bad { border-left-color: var(--danger); }
.banner .title { font-weight: 600; margin-bottom: 0.25rem; color: var(--fg-strong); }

/* ─── KPI strip (overview) ──────────────────────────────────────────────── */
.kpis { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr)); margin: 1rem 0; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem 1.1rem; }
.kpi .v { font-size: 1.85rem; font-weight: 600; line-height: 1.1; color: var(--fg-strong); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.kpi .l { color: var(--muted); font-size: 0.82rem; margin-top: 0.2rem; }
.kpi .h { color: var(--muted); font-size: 0.78rem; margin-top: 0.4rem; }

/* ─── Definition list / metadata ────────────────────────────────────────── */
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1rem; margin: 0.5rem 0; font-size: 0.92rem; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; min-width: 0; word-break: break-word; }
.kv .stack { display: flex; flex-direction: column; gap: 0.25rem; }

/* ─── Tables ────────────────────────────────────────────────────────────── */
.table-wrap { overflow-x: auto; margin: 1rem 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.92rem; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 0.8rem; padding: 0.7rem 0.85rem; background: var(--surface-2); border-bottom: 1px solid var(--border); white-space: nowrap; position: sticky; top: 0; }
td { padding: 0.7rem 0.85rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: rgba(255, 255, 255, 0.025); }
td.num { font-variant-numeric: tabular-nums; }
td .row-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; }
.table-foot { padding: 0.6rem 0.85rem; color: var(--muted); font-size: 0.82rem; border-top: 1px solid var(--border); }

/* Responsive table → cards on narrow viewports. The route emits each cell
   with a data-label attribute; on small screens the label appears next to
   the value so the row reads as a key/value list instead of a clipped row. */
@media (max-width: 720px) {
  table.responsive thead { display: none; }
  table.responsive tbody tr { display: grid; grid-template-columns: 1fr; gap: 0.2rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); }
  table.responsive tbody tr:last-child { border-bottom: 0; }
  table.responsive td {
    display: grid; grid-template-columns: 7rem 1fr; gap: 0.5rem;
    padding: 0.2rem 0; border-bottom: 0;
  }
  table.responsive td::before {
    content: attr(data-label); color: var(--muted); font-size: 0.82rem;
  }
  table.responsive td.num { font-variant-numeric: tabular-nums; }
}

/* ─── Forms ─────────────────────────────────────────────────────────────── */
.form { display: flex; flex-direction: column; gap: 1rem; margin: 1rem 0; max-width: 28rem; }
.form.wide { max-width: none; }
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field label { font-size: 0.88rem; color: var(--muted); }
.field input, .field select, .field textarea {
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem; font: inherit; min-height: 2.5rem; width: 100%;
}
.field input[readonly] { color: var(--muted); background: var(--surface); }
.field textarea { min-height: 16rem; font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.5; resize: vertical; }
.field .hint { color: var(--muted); font-size: 0.82rem; }
.field .err { color: var(--danger); font-size: 0.82rem; }
.field.invalid input, .field.invalid select, .field.invalid textarea { border-color: var(--danger); }
.checkbox-row { display: flex; align-items: center; gap: 0.5rem; }
.checkbox-row input { width: auto; min-height: 0; }
.form-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem; }

/* Login / register shell — narrow column centered on the page, with a
   brand mark so it doesn't feel like a raw textarea. */
.auth-shell {
  min-height: 100vh; display: grid; grid-template-rows: auto 1fr;
  background: var(--bg);
}
.auth-shell header { padding: 1.5rem clamp(1rem, 4vw, 2rem); }
.auth-shell main {
  display: flex; align-items: flex-start; justify-content: center;
  padding: 0 1rem 4rem;
}
.auth-card { width: 100%; max-width: 26rem; margin-top: clamp(1rem, 6vh, 4rem); }
.auth-card .meta { color: var(--muted); font-size: 0.85rem; margin-top: 1rem; text-align: center; }

/* Password input with show/hide toggle. No JS — pure CSS via checkbox hack. */
.password-row { position: relative; display: flex; align-items: stretch; }
.password-row input { padding-right: 3.25rem; }
.password-row .pw-toggle {
  position: absolute; right: 0.35rem; top: 50%; transform: translateY(-50%);
  background: transparent; color: var(--muted); border: 1px solid var(--border);
  border-radius: 4px; padding: 0.2rem 0.55rem; font-size: 0.78rem;
}
.password-row .pw-toggle:hover { color: var(--fg); border-color: var(--accent); }

/* ─── Game detail ───────────────────────────────────────────────────────── */
.game-head {
  display: flex; gap: 0.85rem; align-items: center; flex-wrap: wrap;
  margin-bottom: 1rem;
}
.game-head .id { font-family: var(--font-mono); font-size: 0.85rem; color: var(--muted); padding: 0.15rem 0.5rem; background: var(--code-bg); border-radius: 4px; }

/* ─── Manifest editor ───────────────────────────────────────────────────── */
.game-grid {
  display: grid; gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
}
fieldset.game {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1rem 1.15rem; margin: 0; background: var(--surface);
}
fieldset.game > legend { padding: 0 0.4rem; color: var(--muted); font-size: 0.85rem; }
fieldset.game > .field + .field { margin-top: 0.75rem; }

details.disclosure { margin: 1rem 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
details.disclosure > summary {
  cursor: pointer; padding: 0.85rem 1rem; color: var(--muted);
  list-style: none; display: flex; align-items: center; gap: 0.5rem;
}
details.disclosure > summary::before {
  content: ""; width: 0.5rem; height: 0.5rem; border-right: 1.5px solid var(--muted);
  border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); transition: transform 0.15s;
}
details.disclosure[open] > summary::before { transform: rotate(45deg); }
details.disclosure > summary::-webkit-details-marker { display: none; }
details.disclosure > .body { padding: 0 1rem 1rem; }

.error-list { padding-left: 1.25rem; margin: 0; color: var(--danger); }
.error-list li { margin: 0.25rem 0; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`;
}

export function shell(
  title: string,
  body: string,
  nav: { href: string; label: string; active?: boolean }[],
): string {
  const navHtml = nav
    .map(
      (item) =>
        `<a href="${escapeHtml(item.href)}"${item.active ? ' class="active" aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Bantam Admin</title>
<meta name="color-scheme" content="dark">
<meta name="referrer" content="same-origin">
<style>${css()}</style>
</head>
<body>
<a href="#main" class="skip">Skip to content</a>
<div class="topbar">
  <a href="/admin/" class="brand"><span class="mark">b</span> Bantam Admin</a>
  <nav aria-label="Primary">${navHtml}</nav>
</div>
<div class="shell">
  <main id="main">${body}</main>
</div>
</body>
</html>`;
}

export function publicShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Bantam Admin</title>
<meta name="color-scheme" content="dark">
<meta name="referrer" content="same-origin">
<style>${css()}</style>
</head>
<body class="auth-shell">
<header><a href="/admin/login" class="brand"><span class="mark">b</span> Bantam Admin</a></header>
<main id="main">${body}</main>
<script>
// Password show/hide toggle. Small, isolated to the auth pages; the admin
// session cookie is still HttpOnly + SameSite=Strict so CSRF protection does
// not depend on the absence of client JS.
(function () {
  for (const btn of document.querySelectorAll(".pw-toggle")) {
    const input = btn.parentElement && btn.parentElement.querySelector("input[type=password]");
    if (!input) continue;
    btn.addEventListener("click", function () {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? btn.dataset.hideLabel || "Hide" : btn.dataset.showLabel || "Show";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  }
})();
</script>
</body>
</html>`;
}

// ─── Components ──────────────────────────────────────────────────────────

// Page header with a title, optional subtitle, and an actions slot.
export function pageHead(title: string, subtitle: string, actions = ""): string {
  return `<header class="page-head">
  <div>
    <h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
  </div>${actions ? `<div class="actions">${actions}</div>` : ""}
</header>`;
}

// KPI tile for the overview strip.
export function kpi(label: string, value: string | number, hint = ""): string {
  return `<div class="kpi"><div class="v">${escapeHtml(String(value))}</div><div class="l">${escapeHtml(label)}</div>${hint ? `<div class="h">${escapeHtml(hint)}</div>` : ""}</div>`;
}

// Responsive table. `rows` is an array of cell objects; each cell carries
// the visible markup and a `label` for the responsive card view.
type Cell = { html: string; label: string; numeric?: boolean };
export function renderTable(headers: string[], rows: Cell[][], foot = ""): string {
  const th = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  const tr = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell) =>
              `<td${cell.numeric ? ' class="num"' : ""} data-label="${escapeHtml(cell.label)}">${cell.html}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const footHtml = foot ? `<div class="table-foot">${foot}</div>` : "";
  return `<div class="table-wrap"><table class="responsive"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>${footHtml}</div>`;
}

// Backward-compatible wrapper for code that still passes strings.
export function renderTableLegacy(headers: string[], rows: string[][]): string {
  const cells = rows.map((row) =>
    row.map((html, idx) => ({ html, label: headers[idx] ?? "", numeric: false })),
  );
  return renderTable(headers, cells);
}

export function renderKv(pairs: [string, string][]): string {
  const items = pairs.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join("");
  return `<dl class="kv">${items}</dl>`;
}

export function badge(text: string, kind: "ok" | "bad" | "neutral" | "warn" = "ok"): string {
  if (kind === "neutral")
    return `<span class="tag neutral"><span class="dot"></span>${escapeHtml(text)}</span>`;
  return `<span class="tag ${kind}"><span class="dot"></span>${escapeHtml(text)}</span>`;
}

export function banner(text: string, kind: "ok" | "bad" | "warn" = "warn", title = ""): string {
  const head = title ? `<div class="title">${escapeHtml(title)}</div>` : "";
  return `<div class="banner ${kind}" role="status">${head}${text}</div>`;
}

export function errorList(errors: string[]): string {
  if (errors.length === 0) return "";
  return `<ul class="error-list">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
}

// Field wrapper used by all forms. Each input keeps its own `name` so we
// don't depend on a class-aware framework.
export function field(label: string, control: string, hint = "", required = false): string {
  return `<div class="field${required ? "" : ""}">
  <label>${escapeHtml(label)}${required ? ' <span aria-hidden="true">*</span>' : ""}</label>
  ${control}${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}
</div>`;
}

// In-place confirm that does not need JS: a <details>/summary that hides a
// submit button until the operator opts in. Replaces the old `onsubmit`
// `confirm()` dialog (which is also a CSP/script smell in a strict cookie
// context).
export function confirmAction(label: string, danger = false): string {
  return `<details class="disclosure" style="margin:0">
  <summary>${escapeHtml(label)}</summary>
  <div class="body">
    <p class="muted" style="margin:0 0 0.5rem">Confirm before continuing. This action cannot be undone.</p>
    <button type="submit" class="btn ${danger ? "danger" : "primary"} small">${escapeHtml(label)}</button>
  </div>
</details>`;
}
