import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/firmware/catalog";
import { MODELS } from "../src/models";
import { modelPageHtml, radioListHtml, robotsTxt, sitemapXml, type SiteData } from "../src/seo/site";

const manifest: Manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "public", "firmware", "manifest.json"), "utf8"),
);
const data: SiteData = {
  origin: "https://example.test",
  models: MODELS,
  firmware: manifest.firmware,
  repoUrl: "https://github.com/x/y",
};

describe("SEO pages", () => {
  it("lists every radio page in the sitemap and on the home page", () => {
    const sitemap = sitemapXml(data);
    const list = radioListHtml(data);
    for (const m of MODELS) {
      expect(sitemap).toContain(`<loc>https://example.test/radios/${m.id}/</loc>`);
      expect(list).toContain(`href="radios/${m.id}/"`);
    }
  });

  it.each(MODELS.map((m) => [m.id, m] as const))("%s page lists every bundled version and deep-links the app", (_, m) => {
    const html = modelPageHtml(data, m, "../../assets/x.css");
    for (const f of manifest.firmware.filter((x) => x.modelId === m.id)) expect(html).toContain(`<td>V${f.version}</td>`);
    expect(html).toContain(`href="../../?model=${m.id}"`);
    expect(html).toContain(`<link rel="canonical" href="https://example.test/radios/${m.id}/" />`);
  });

  it("keeps firmware binaries out of the index but lets the manifest load", () => {
    const robots = robotsTxt(data);
    expect(robots).toContain("Disallow: /firmware/");
    expect(robots).toContain("Allow: /firmware/manifest.json");
    expect(robots).toContain("Sitemap: https://example.test/sitemap.xml");
  });
});
