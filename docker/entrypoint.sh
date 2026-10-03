#!/bin/sh
# Write τ's config if none is mounted, then run the daemon in the foreground.
set -eu

/usr/local/bin/tau-code-config

# 0.0.0.0 is not a choice the caller should have to remember: bound to
# 127.0.0.1 the daemon would be unreachable from outside the container, which
# is the whole point of publishing the port. Publish it on the host's loopback
# (-p 127.0.0.1:8256:8256) if you do not want it on your network.
#
# --web-root rather than config, because a mounted config.json is the user's
# and this image does not edit it; the flag says where THIS image's web client
# is, and a caller's own --listen or --web-root after it wins.
#
# The daemon's Origin check compares a browser's Origin with the Host it
# dialled, so a remapped port (-p 9000:8256) or an ssh tunnel still passes. A
# token is opt-in, as it is for τ everywhere: set serve.token in a mounted
# config.json, and open the page with ?token=... .
exec tau serve --listen 0.0.0.0:8256 --web-root "${TAU_CODE_WEB}" "$@"
