import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.SITE ?? "https://onlyfurn-app.dzimba.dev",
  // Dokploy runs this as a Railpacks-built Node service: `npm run start` boots
  // the standalone server. `server.host` is what the adapter feeds to
  // `http.listen()`; without it the server binds localhost only and the
  // Dokploy/Traefik proxy cannot reach it. PORT comes from the platform env.
  //
  // No @astrojs/sitemap integration: every route renders on demand, so Astro
  // knows no product paths at build time. src/pages/sitemap.xml.ts generates
  // the sitemap from the live WordPress catalogue instead.
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true },
  image: {
    remotePatterns: [{ protocol: "https", hostname: "onlyfurn.co.za" }],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
