# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# ONLYFURN — Astro storefront on the @astrojs/node standalone server.
#
# Every route renders on demand, so the build never contacts WordPress and
# needs no credentials. Products added in WordPress are served live, with no
# rebuild. `astro build` produces only the server bundle and the shell assets.
#
# This means the image is fully reproducible from the repository: no build args,
# no secrets, nothing environment-specific baked in. In particular the WooCommerce
# credentials are NOT compiled into the image. src/lib/wordpress.ts reads
# process.env at request time, so they are supplied as runtime environment
# variables and stay out of every layer.
#
# Runtime environment (set these in Dokploy's Environment tab, or however you
# prefer — they are never baked into the image):
#
#   PORT                  optional, defaults to 3000 below; the standalone server
#                         prefers process.env.PORT when the platform sets it
#   WORDPRESS_URL         optional, defaults to https://onlyfurn.co.za
#   WC_CONSUMER_KEY       WooCommerce REST key. With key + secret the catalogue is
#   WC_CONSUMER_SECRET    read from authenticated /wc/v3; without them it falls
#                         back to the public /wc/store/v1 API, which needs no
#                         credentials but cannot serve customers or orders
#   WORDPRESS_CACHE_TTL   optional, defaults to 300 seconds
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
# Astro requires Node >= 22.12; engines in package.json enforces it here.
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# The server bundle externalises several packages and loads Sharp lazily via
# `await import("sharp")` for runtime image optimisation, so the runtime stage
# needs the production dependency tree, not just dist/.
FROM node:22-slim AS runner
WORKDIR /app
# PORT must be set explicitly. @astrojs/node takes its default from Astro's
# `server.port` (4321), not from a sensible production value, so without this
# the container listens on 4321 while the proxy forwards to 3000 and every
# request is refused. The standalone server prefers process.env.PORT, so a
# platform that sets its own PORT still wins.
ENV NODE_ENV=production \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "./dist/server/entry.mjs"]
