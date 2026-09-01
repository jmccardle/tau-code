# tau-code as a container: a tau agent, served to a browser.
#
# The image holds two runtimes, because that is what this is. Python runs tau
# itself, installed from PyPI. Node runs the connection server, which owns the
# `tau --mode rpc` child process and serves the web client to browsers.
#
#   docker build -t ffwf/tau-code .
#   docker run --rm -p 127.0.0.1:8791:8791 -v "$PWD:/work" \
#     -e TAU_MODEL_BASE_URL=http://host.docker.internal:8000/v1 \
#     ffwf/tau-code
#
# The container prints an authenticated URL. Open it.

ARG NODE_VERSION=20

# ---------------------------------------------------------------- build stage
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src

# package.json files first, so a source edit does not re-run npm ci.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/runner/package.json   packages/runner/
COPY packages/ui/package.json       packages/ui/
COPY packages/web/package.json      packages/web/
COPY packages/server/package.json   packages/server/
COPY packages/vscode/package.json   packages/vscode/
RUN npm ci

COPY . .
# `generate` is NOT run here: it needs a live tau, and generated.ts is committed
# precisely so a build does not. `npm run check:protocol` is the guard against
# that file drifting, and it belongs in the checkout, not in an image build.
RUN npm run build

# -------------------------------------------------------------- runtime stage
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# Which tau. Bump this line when a release adds a verb this client uses.
# 0.9.6 speaks protocol 1.3: everything works except `@file` completion, which
# needs complete_path (protocol 1.4, unreleased at the time of writing). The
# composer says so in the UI rather than failing.
ARG TAU_SPEC=ffwf-tau==0.9.6

# The agent's tools resolve against a bind-mounted /work, so the container user
# has to match the host user who owns it. -o allows a duplicate id; the node
# image already has a user at 1000, which is why this modifies rather than adds.
ARG TAU_UID=1000
ARG TAU_GID=1000

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/tau \
 && /opt/tau/bin/pip install --no-cache-dir "${TAU_SPEC}"

RUN groupmod -o -g "${TAU_GID}" node \
 && usermod  -o -u "${TAU_UID}" -g "${TAU_GID}" node \
 && mkdir -p /work \
 && chown -R "${TAU_UID}:${TAU_GID}" /work /home/node

# Only the server's runtime closure, laid out as node_modules so Node's own
# resolution finds it: /app/node_modules is on the walk-up path from
# .../tau-code-server/dist. ws is the one third-party dependency; react and vite
# built the web client and are not needed to serve it.
COPY --from=build /src/node_modules/ws                /app/node_modules/ws
COPY --from=build /src/packages/protocol/dist         /app/node_modules/@ffwf/tau-code-protocol/dist
COPY --from=build /src/packages/protocol/package.json /app/node_modules/@ffwf/tau-code-protocol/
COPY --from=build /src/packages/runner/dist           /app/node_modules/@ffwf/tau-code-runner/dist
COPY --from=build /src/packages/runner/package.json   /app/node_modules/@ffwf/tau-code-runner/
COPY --from=build /src/packages/server/dist           /app/node_modules/@ffwf/tau-code-server/dist
COPY --from=build /src/packages/server/dist-web       /app/node_modules/@ffwf/tau-code-server/dist-web
COPY --from=build /src/packages/server/package.json   /app/node_modules/@ffwf/tau-code-server/

ENV HOME=/home/node \
    TAU_BIN=/opt/tau/bin/tau \
    TAU_CODE_SERVER=/app/node_modules/@ffwf/tau-code-server/dist/cli.js \
    NODE_ENV=production

COPY docker/write-config.sh /usr/local/bin/tau-code-config
COPY docker/entrypoint.sh   /usr/local/bin/tau-code-entrypoint

USER node
WORKDIR /work
EXPOSE 8791
ENTRYPOINT ["/usr/local/bin/tau-code-entrypoint"]
CMD []

# --------------------------------------------------------------- verify stage
# Proves the image can start tau and speak the protocol. No model is contacted,
# but tau still refuses to start without one configured, so this stage bakes an
# address nothing listens on -- which is honest, because nothing calls it.
#
#   docker build --target verify -t ffwf/tau-code-verify . \
#     && docker run --rm ffwf/tau-code-verify
FROM runtime AS verify
COPY docker/verify.mjs /app/verify.mjs
ENV TAU_MODEL_BASE_URL=http://127.0.0.1:1/v1 \
    TAU_MODEL_NAME=unused-by-verify
ENTRYPOINT []
CMD ["sh", "-c", "tau-code-config && node /app/verify.mjs"]
