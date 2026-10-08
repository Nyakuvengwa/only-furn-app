# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# ONLYFURN — Astro storefront on the @astrojs/node standalone server.
#
# Only three build arguments are required, and only because `astro build`
# prerenders every route, so WordPress is queried while the image is built.
#
#   WC_CONSUMER_KEY + WC_CONSUMER_SECRET
#       Gate HAS_WC_CREDENTIALS in src/lib/wordpress.ts. With them the build
#       reads the authenticated `wc/v3` catalogue. Without them it silently
#       drops to the public `/wc/store/v1` API instead. That fallback renders
#       every field the theme needs, so the build still succeeds — which is
#       exactly why the credentials are passed explicitly rather than left to
#       chance. It cannot serve customers or orders, which wc/v3 can.
#
#   WORDPRESS_URL
#       WordPress origin. Only needed if it ever moves off onlyfurn.co.za,
#       which is the compiled-in default.
#
# Not needed at build time:
#   SITE                       falls back to the production URL in astro.config.mjs
#   WORDPRESS_CACHE_TTL        falls back to 300
#   WP_USERNAME / WP_APP_PASSWORD
#   WC_AUTH_TOKEN_ENDPOINT     read only by customer-auth helpers that the
#                              theme does not call (src/lib/wordpress.ts)
#
# Supply these as Dokploy **Build Arguments**, not `environment:` — environment
# is applied after the image is built, which is too late for a prerendered site.
#
# Astro inlines `import.meta.env` at build time, so these are baked into
# dist/server and are deliberately not repeated as runtime env. The only runtime
# variable the server reads is PORT.
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
# Astro requires Node >= 22.12; engines in package.json enforces it here.
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .

ARG WC_CONSUMER_KEY
ARG WC_CONSUMER_SECRET
ARG WORDPRESS_URL

ENV WC_CONSUMER_KEY=${WC_CONSUMER_KEY} \
    WC_CONSUMER_SECRET=${WC_CONSUMER_SECRET} \
    WORDPRESS_URL=${WORDPRESS_URL}

RUN npm run build

# The server bundle externalises several packages and loads Sharp lazily via
# `await import("sharp")` for runtime image optimisation, so the runtime stage
# needs the production dependency tree, not just dist/.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "./dist/server/entry.mjs"]
