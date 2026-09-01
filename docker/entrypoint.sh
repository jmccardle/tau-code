#!/bin/sh
# Write tau's config, then start the connection server.
set -eu

/usr/local/bin/tau-code-config

# --bind 0.0.0.0 is not a choice the caller should have to remember: bound to
# 127.0.0.1 the server would be unreachable from outside the container, which is
# the whole point of publishing the port. Publish it on the host's loopback
# (-p 127.0.0.1:8791:8791) if you do not want it on your network.
#
# Both defaults come first, so a caller's own --bind or --cwd wins: the argument
# parser takes the last occurrence of a flag.
# TAU_CODE_TOKEN is for the case the printed URL cannot cover: with a remapped
# port (-p 8799:8791) the server prints the port it listens on, not the one you
# dialled, so the link is not clickable and you have to build your own. Setting
# the token makes that possible. It lands in the process arguments, so it is
# readable by anyone who can run `docker inspect` on this container.
if [ -n "${TAU_CODE_TOKEN:-}" ]; then
    set -- --token "${TAU_CODE_TOKEN}" "$@"
fi

exec node "${TAU_CODE_SERVER}" --bind 0.0.0.0 --cwd /work "$@"
