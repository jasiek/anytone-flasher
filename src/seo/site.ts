// Static, crawlable content generated at build time (see vite.config.ts):
// the supported-radio list injected into index.html, one landing page per
// radio, sitemap.xml and robots.txt. Everything comes from MODELS and the
// firmware manifest, so new firmware shows up without editing copy.

import type { FirmwareEntry } from "../firmware/catalog";
import { MCU_LABEL, type RadioModel } from "../models";

export const SITE_NAME = "AnyTone Flasher";

export interface SiteData {
  origin: string; // e.g. "https://anytone-flasher.jasiek.me"
  models: RadioModel[];
  firmware: FirmwareEntry[];
  repoUrl: string;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "AnyTone AT-D578UV / UV Pro (mobile)" -> "AT-D578UV / UV Pro" */
const shortName = (m: RadioModel) => m.name.replace(/^AnyTone /, "").replace(/ \(mobile\)$/, "");

export const modelPath = (m: RadioModel) => `radios/${m.id}/`;

interface Release {
  version: string;
  date: string | null;
  builds: FirmwareEntry[];
}

function releases(data: SiteData, m: RadioModel): Release[] {
  const out: Release[] = [];
  for (const f of data.firmware) {
    if (f.modelId !== m.id) continue;
    const r = out.find((x) => x.version === f.version);
    if (r) r.builds.push(f);
    else out.push({ version: f.version, date: f.date, builds: [f] });
  }
  return out;
}

const versionRange = (rs: Release[]) => (rs.length ? `V${rs.at(-1)!.version}–V${rs[0]!.version}` : "");

/** Supported radios list for the home page (inside the static "about" section). */
export function radioListHtml(data: SiteData): string {
  const items = data.models.map((m) => {
    const rs = releases(data, m);
    const latest = rs[0];
    return `<li><a href="${modelPath(m)}">${esc(m.name)}</a> <span class="muted">· ${rs.length} firmware versions, ${esc(
      versionRange(rs),
    )}${latest?.date ? `, latest ${latest.date}` : ""}</span></li>`;
  });
  return `<ul class="radio-list">\n${items.join("\n")}\n</ul>`;
}

export function homeJsonLd(data: SiteData): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: `${data.origin}/`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Windows, macOS, Linux, ChromeOS (Chrome, Edge or Opera)",
    browserRequirements: "Requires the Web Serial API (desktop Chrome, Edge or Opera)",
    description: homeDescription(data),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    codeRepository: data.repoUrl,
    featureList: [
      "Flash official AnyTone firmware over USB from the browser",
      "Codeplug backup before flashing",
      "Automatic GD32 / AT32 build selection",
      ...data.models.map((m) => `${m.name} firmware update`),
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

export function homeDescription(data: SiteData): string {
  const names = data.models.map((m) => m.identModel.replace(/2$/, "II")).join(", ");
  return (
    `Update AnyTone DMR radio firmware in your browser over USB, with no CPS or Windows needed. ` +
    `Every official release bundled for the ${names}, with a codeplug backup before flashing.`
  );
}

function head(opts: { title: string; description: string; url: string; css: string; origin: string; extra?: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${esc(opts.title)}</title>
    <meta name="description" content="${esc(opts.description)}" />
    <link rel="canonical" href="${opts.url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${esc(opts.title)}" />
    <meta property="og:description" content="${esc(opts.description)}" />
    <meta property="og:url" content="${opts.url}" />
    <meta property="og:image" content="${opts.origin}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23e8590c' d='M13 2 4 14h7l-1 8 9-12h-7z'/></svg>" />
    <link rel="stylesheet" href="${opts.css}" />
    ${opts.extra ?? ""}
  </head>`;
}

/** Landing page for one radio, served at /radios/<id>/. */
export function modelPageHtml(data: SiteData, m: RadioModel, cssHref: string): string {
  const rs = releases(data, m);
  const latest = rs[0];
  const url = `${data.origin}/${modelPath(m)}`;
  const name = shortName(m);
  const title = `AnyTone ${name} firmware update${latest ? ` (V${latest.version})` : ""} – flash in your browser`;
  const description =
    `Update AnyTone ${name} firmware from Chrome or Edge over USB. ` +
    `${rs.length} official versions bundled (${versionRange(rs)}). ` +
    `Back up the codeplug, flash and see progress. No CPS or Windows needed.`;
  const twoMcu = Object.values(m.firmwareTags).some((x) => x);
  const rows = rs
    .map((r) => {
      const mcus = r.builds.map((b) => (b.mcu ? MCU_LABEL[b.mcu] : "")).filter(Boolean);
      const size = `${r.builds.map((b) => (b.size / 1024).toFixed(0)).join(" / ")} KB`;
      return `<tr><td>V${esc(r.version)}</td><td>${r.date ?? ""}</td>${
        twoMcu ? `<td>${mcus.join(" + ")}</td>` : ""
      }<td>${size}</td></tr>`;
    })
    .join("\n");
  const others = data.models
    .filter((o) => o !== m)
    .map((o) => `<li><a href="../${o.id}/">${esc(o.name)}</a></li>`)
    .join("\n");
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${data.origin}/` },
      { "@type": "ListItem", position: 2, name: `${name} firmware`, item: url },
    ],
  };
  return `${head({
    title,
    description,
    url,
    css: cssHref,
    origin: data.origin,
    extra: `<script type="application/ld+json">${JSON.stringify(crumbs)}</script>`,
  })}
  <body>
    <main class="wrap">
      <header>
        <p class="crumbs"><a href="../../">${SITE_NAME}</a> › Radios</p>
        <h1>AnyTone ${esc(name)} firmware update</h1>
        <p class="lede">Flash official ${esc(m.name)} firmware from your browser over USB. No CPS and no Windows
        needed: desktop Chrome, Edge or Opera on Windows, macOS, Linux or ChromeOS.</p>
      </header>

      <p><a class="button primary" href="../../?model=${m.id}">Open the flasher for the ${esc(name)}</a></p>
      ${m.notes ? `<p class="banner warn">${esc(m.notes)}</p>` : ""}

      <section class="step">
        <h2>How to update the ${esc(name)}</h2>
        <ol class="instructions">
          <li>Connect the programming cable and switch the radio on normally. The flasher can save a codeplug
          backup first, because the update erases the codeplug.</li>
          <li>Start the radio in firmware-update mode. ${esc(m.updateMode)}</li>
          <li>Pick the version and the serial port, then press <strong>Flash firmware</strong> and watch the
          progress.</li>
          <li>Run the installer on the radio. ${esc(m.install)}</li>
          <li>Write your codeplug back with the CPS version that matches the new firmware.</li>
        </ol>
      </section>

      <section class="step">
        <h2>Bundled ${esc(name)} firmware versions</h2>
        <p class="muted">Official AnyTone releases, unmodified${latest?.date ? `. Latest: V${esc(latest.version)} (${latest.date})` : ""}.</p>
        <table class="versions">
          <thead><tr><th>Version</th><th>Date</th>${twoMcu ? "<th>Builds</th>" : ""}<th>Size</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </section>

      <section class="step">
        <h2>Other radios</h2>
        <ul>
${others}
        </ul>
      </section>

      <footer class="muted">
        <a href="${data.repoUrl}">Source on GitHub</a>. Firmware © Qixiang Electron (AnyTone), redistributed unmodified.
        No warranty: use at your own risk.
      </footer>
    </main>
  </body>
</html>
`;
}

export function sitemapXml(data: SiteData): string {
  const latest = (fw: FirmwareEntry[]) => fw.map((f) => f.date ?? "").sort().at(-1) || "";
  const urls = [
    { loc: `${data.origin}/`, lastmod: latest(data.firmware) },
    ...data.models.map((m) => ({
      loc: `${data.origin}/${modelPath(m)}`,
      lastmod: latest(data.firmware.filter((f) => f.modelId === m.id)),
    })),
  ];
  const line = (u: { loc: string; lastmod: string }) =>
    `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(line).join("\n")}
</urlset>
`;
}

export function robotsTxt(data: SiteData): string {
  return `User-agent: *
Allow: /
Allow: /firmware/manifest.json
Disallow: /firmware/

Sitemap: ${data.origin}/sitemap.xml
`;
}
