import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.SITE ?? "https://onlyfurn-app.dzimba.dev",
  // Dokploy runs this as a Railpacks-built Node service: `npm run start` boots
  // the standalone server. `server.host` is what the adapter feeds to
  // `http.listen()`; without it the server binds localhost only and the
  // Dokploy/Traefik proxy cannot reach it. PORT comes from the platform env.
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true },
  integrations: [sitemap()],
  // Product imagery is served from the WordPress origin. Astro fetches these at
  // build time and re-encodes them to WebP through the same pipeline the
  // bundled local assets use, so <Image> behaves identically for both.
  image: {
    remotePatterns: [{ protocol: "https", hostname: "onlyfurn.co.za" }],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
