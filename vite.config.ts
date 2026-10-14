import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// base "./" keeps the build relocatable: it works from any sub-path or static host.
// HTTPS=1 serves over a self-signed certificate, so Web Serial (secure contexts
// only) works when the page is opened from another device on the LAN.
export default defineConfig({
  base: "./",
  plugins: process.env.HTTPS ? [basicSsl()] : [],
});
