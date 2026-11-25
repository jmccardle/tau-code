#!/bin/sh
# Write τ's config if none is mounted, then run `tau serve` in the foreground.
set -eu

/usr/local/bin/tau-code-config

# τ ≥ 0.17 serves ONE session per process, over its HTTP edge (D29) and a Unix socket. With no
# session flag this is a new session in /work; pass `-c` (the newest session of /work, when
# ~/.tau is a mounted volume) or `--session ID` as the container's command to open another.
#
# --host 0.0.0.0 is not a choice the caller should have to remember: bound to 127.0.0.1 the server
# would be unreachable from outside the container, which is the whole point of publishing the
# port. τ refuses a non-loopback host without --allow-network, which is what this flag says: anyone
# who can reach the port AND has the token. Publish it on the host's loopback
# (-p 127.0.0.1:8256:8256) if you do not want it on your network.
#
# The bearer token is random per start. τ prints the page's address with the token in it
# (`open: http://0.0.0.0:8256/#token=…`) only when its standard output is a terminal, so run the
# container with -t; otherwise `docker exec CONTAINER sh -c 'cat ~/.tau/serve/*.json'` shows it.
#
# ORIGINS. τ lets a page call /stream only from the server's own origin, which it computes from the
# address it is bound to: http://0.0.0.0:8256 here. A browser on the host sees the page at the
# PUBLISHED address -- http://127.0.0.1:8256 for the `-p 127.0.0.1:8256:8256` this image documents
# -- so that origin, and localhost's, are allowed by default. Publish another port or host name
# and set TAU_CODE_ORIGINS to match (space-separated), e.g.
#   -p 127.0.0.1:9000:8256 -e TAU_CODE_ORIGINS=http://127.0.0.1:9000
# A page from any other origin is refused (403), which is τ's rule, not this image's.
#
# --web-root rather than τ's installed tau_web, because the flag says where THIS image's web client
# is (built from this checkout); a caller's own flags after it win.
set --  --host 0.0.0.0 --allow-network --port 8256 --web-root "${TAU_CODE_WEB}" "$@"
for origin in ${TAU_CODE_ORIGINS:-http://127.0.0.1:8256 http://localhost:8256}; do
    set -- --allow-origin "$origin" "$@"
done
exec tau serve "$@"
