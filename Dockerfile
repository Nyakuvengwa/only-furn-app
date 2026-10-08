# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# ONLYFURN — Astro storefront on the @astrojs/node standalone server.
#
# WordPress credentials are BUILD-TIME secrets. `astro build` prerenders every
# route, so it queries the WooCommerce catalogue while the image is built. Astro
# inlines them into dist/server, so the container needs nothing at runtime
# beyond PORT.
#
# They are passed with BuildKit secret mounts using `env=`, which exposes each
# secret to that single RUN as an environment variable. Nothing lands in image
# metadata, `docker history`, or any layer, and no ARG/ENV is needed.
#
#   docker build \
#     --secret id=WC_CONSUMER_KEY \
#     --secret id=WC_CONSUMER_SECRET \
#     --secret id=WORDPRESS_URL \
#     .
#
# Passing `id=NAME` with no src binds the identically named environment variable
# from the build client. To read them from a file instead, add `,src=.env`.
#
# WC_CONSUMER_KEY / WC_CONSUMER_SECRET are required. Without them
# HAS_WC_CREDENTIALS in src/lib/wordpress.ts is false and the build silently
# falls back to the public /wc/store/v1 API, producing a site that looks fine
# while carrying the wrong catalogue — hence the explicit check below.
# WORDPRESS_URL is optional and falls back to https://onlyfurn.co.za.
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
# Astro requires Node >= 22.12; engines in package.json enforces it here.
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .

# `required=false` lets WORDPRESS_URL be omitted without failing the build.
RUN --mount=type=secret,id=WC_CONSUMER_KEY,env=WC_CONSUMER_KEY \
    --mount=type=secret,id=WC_CONSUMER_SECRET,env=WC_CONSUMER_SECRET \
    --mount=type=secret,id=WORDPRESS_URL,env=WORDPRESS_URL,required=false \
    sh -c 'test -n "$WC_CONSUMER_KEY" || { echo "ERROR: WC_CONSUMER_KEY was not supplied to the build" >&2; echo "  docker build --secret id=WC_CONSUMER_KEY ..." >&2; exit 1; }; test -n "$WC_CONSUMER_SECRET" || { echo "ERROR: WC_CONSUMER_SECRET was not supplied to the build" >&2; echo "  docker build --secret id=WC_CONSUMER_SECRET ..." >&2; exit 1; }; npm run build'

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
