# tau-code as a container: `tau serve`, with the web client it hosts.
#
# The image is τ and a directory of static files. `tau serve` is the daemon
# that owns the sessions, speaks the serve protocol on its port, and answers a
# plain HTTP GET on the same port with the web client from --web-root -- so the
# page and its socket are one origin and nothing else runs. Node builds the web
# client and is not in the image.
#
#   docker build -t ffwf/tau-code .
#   docker run --rm -p 127.0.0.1:8256:8256 -v "$PWD:/work" \
#     -e TAU_MODEL_BASE_URL=http://host.docker.internal:8000/v1 \
#     ffwf/tau-code
#
# Then open http://127.0.0.1:8256/.

# The Node that builds the web client. It is not shipped, so this is only a
# build tool's version; it matches NODE_VERSION in the release workflow so the
# image and the .vsix are built by one Node.
ARG NODE_VERSION=24

# ------------------------------------------------------------ τ wheels (opt.)
# Empty unless the build is given a directory of wheels:
#
#   docker build --build-context tau-wheels=PATH/TO/WHEELS .
#
# Then `pip install` looks there before PyPI. This is how the image is built
# against a τ that is not released yet -- a local `python -m build` of
# agent-harness-py -- without a path to a checkout written into this file.
FROM scratch AS tau-wheels

# ---------------------------------------------------------------- build stage
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src

# package.json files first, so a source edit does not re-run npm ci. npm ci
# wants every workspace's manifest, including the two this stage never builds.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/ui/package.json       packages/ui/
COPY packages/web/package.json      packages/web/
COPY packages/runtime/package.json  packages/runtime/
COPY packages/vscode/package.json   packages/vscode/
RUN npm ci

COPY . .
# Only the web client and what it is built from. `generate` is NOT run here:
# it needs a live τ, and generated.ts is committed precisely so a build does
# not. `npm run check:protocol` is the guard against drift, in the checkout.
RUN npx tsc --build packages/web \
 && npm run build --workspace @ffwf/tau-code-web

# -------------------------------------------------------------- runtime stage
FROM python:3.12-slim-bookworm AS runtime

# Which τ. `[serve]` brings the WebSocket daemon. 0.14.1 speaks serve protocol
# 0.11, the one this client was generated against. A τ that is not on PyPI
# yet builds with --build-context tau-wheels (above).
#
# packages/runtime pins the same release. Those two move together: two
# artifacts shipping two τs is how a client ends up tested against neither.
ARG TAU_SPEC=ffwf-tau[serve]==0.14.1

# The agent's tools resolve against a bind-mounted /work, so the container user
# has to match the host user who owns it.
ARG TAU_UID=1000
ARG TAU_GID=1000

RUN --mount=type=bind,from=tau-wheels,target=/wheels \
    python -m venv /opt/tau \
 && /opt/tau/bin/pip install --no-cache-dir --find-links /wheels "${TAU_SPEC}"

RUN groupadd -o -g "${TAU_GID}" tau \
 && useradd -o -m -u "${TAU_UID}" -g "${TAU_GID}" -d /home/tau tau \
 && mkdir -p /work \
 && chown -R "${TAU_UID}:${TAU_GID}" /work

COPY --from=build /src/packages/web/dist-web /opt/tau-code/web

ENV HOME=/home/tau \
    PATH=/opt/tau/bin:$PATH \
    TAU_CODE_WEB=/opt/tau-code/web

COPY docker/write-config.sh /usr/local/bin/tau-code-config
COPY docker/entrypoint.sh   /usr/local/bin/tau-code-entrypoint

USER tau
WORKDIR /work
EXPOSE 8256
ENTRYPOINT ["/usr/local/bin/tau-code-entrypoint"]
CMD []

# --------------------------------------------------------------- verify stage
# Proves the image serves: the daemon starts, says hello at the protocol
# version this client was generated against, and serves the web client's page
# on the same port. No model is contacted, but τ refuses to start without one
# configured, so this stage bakes an address nothing listens on -- which is
# honest, because nothing calls it.
#
#   docker build --target verify -t ffwf/tau-code-verify . \
#     && docker run --rm ffwf/tau-code-verify
FROM runtime AS verify
COPY packages/protocol/src/generated.ts /opt/tau-code/generated.ts
COPY docker/verify.py /opt/tau-code/verify.py
ENV TAU_MODEL_BASE_URL=http://127.0.0.1:1/v1 \
    TAU_MODEL_NAME=unused-by-verify
ENTRYPOINT []
CMD ["sh", "-c", "tau-code-config && python /opt/tau-code/verify.py"]
