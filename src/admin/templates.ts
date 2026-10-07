// Server-rendered HTML for the admin UI. Plain string templates — no framework,
// no client JS. CSS lives inline in `css()`. Every dynamic string passes
// through `escapeHtml` to avoid XSS even though the data sources are trusted.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function css(): string {
  return `:root{color-scheme:light dark;--bg:#0f1115;--fg:#e6e6e6;--muted:#9aa0a6;--border:#2a2d31;--accent:#24d6c8;--warn:#f5a524;--bad:#f87171}
* { box-sizing: border-box; }
body { font-family: ui-monospace, Cascadia Code, Consolas, monospace; margin: 0; padding: 1.5rem; background: var(--bg); color: var(--fg); }
h1,h2,h3 { margin: 0 0 1rem; font-weight: 600; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.1rem; margin-top: 1.5rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
nav { display: flex; gap: 1rem; padding-bottom: 1rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
nav a { color: var(--muted); }
nav a.active { color: var(--fg); }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; }
th,td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; font-size: 0.85rem; }
tr:hover td { background: rgba(255,255,255,0.02); }
.tag { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 0.25rem; font-size: 0.8rem; }
.tag.ok { background: rgba(36,214,159,0.15); color: var(--accent); }
.tag.bad { background: rgba(248,113,113,0.15); color: var(--bad); }
.muted { color: var(--muted); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0 1rem; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }`;
}

export function shell(
  title: string,
  body: string,
  nav: { href: string; label: string; active?: boolean }[],
): string {
  const navHtml = nav
    .map(
      (item) =>
        `<a href="${escapeHtml(item.href)}"${item.active ? ' class="active"' : ""}>${escapeHtml(item.label)}</a>`,
    )
    .join(" ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · Bantam Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css()}</style>
</head>
<body>
<nav>${navHtml}</nav>
${body}
</body>
</html>`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const tr = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export function renderKv(pairs: [string, string][]): string {
  const items = pairs.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join("");
  return `<dl class="kv">${items}</dl>`;
}

export function badge(text: string, kind: "ok" | "bad" | "neutral" = "ok"): string {
  if (kind === "neutral") return `<span class="muted">${escapeHtml(text)}</span>`;
  return `<span class="tag ${kind}">${escapeHtml(text)}</span>`;
}
