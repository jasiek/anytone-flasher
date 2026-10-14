import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import type { Manifest } from "./src/firmware/catalog";
import { MODELS } from "./src/models";
import {
  esc,
  homeDescription,
  homeJsonLd,
  modelPageHtml,
  modelPath,
  radioListHtml,
  robotsTxt,
  sitemapXml,
  type SiteData,
} from "./src/seo/site";
import { REPO_URL } from "./src/report";

function siteData(): SiteData {
  const host = readFileSync(new URL("./public/CNAME", import.meta.url), "utf8").trim();
  const manifest: Manifest = JSON.parse(
    readFileSync(new URL("./public/firmware/manifest.json", import.meta.url), "utf8"),
  );
  return {
    origin: `https://${host}`,
    models: MODELS,
    firmware: manifest.firmware,
    repoUrl: REPO_URL,
  };
}

/** Injects crawlable content into index.html and emits per-radio pages, sitemap and robots.txt. */
function seo(): Plugin {
  return {
    name: "anytone-seo",
    transformIndexHtml(html) {
      const data = siteData();
      return html
        .replaceAll("%SEO_DESCRIPTION%", esc(homeDescription(data)))
        .replaceAll("%SEO_ORIGIN%", data.origin)
        .replace("<!--seo:jsonld-->", homeJsonLd(data))
        .replace("<!--seo:radios-->", radioListHtml(data));
    },
    generateBundle(_, bundle) {
      const data = siteData();
      const css = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".css"));
      if (!css) this.error("No CSS asset to link from the radio pages");
      for (const m of data.models) {
        this.emitFile({
          type: "asset",
          fileName: `${modelPath(m)}index.html`,
          source: modelPageHtml(data, m, `../../${css.fileName}`),
        });
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(data) });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt(data) });
    },
  };
}

// base "./" keeps the build relocatable: it works from any sub-path or static host.
// HTTPS=1 serves over a self-signed certificate, so Web Serial (secure contexts
// only) works when the page is opened from another device on the LAN.
function appVersion() {
  try {
    return (process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { encoding: "utf8" })).trim().slice(0, 7);
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  base: "./",
  plugins: [seo(), ...(process.env.HTTPS ? [basicSsl()] : [])],
});
