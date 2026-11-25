"""Prove the image serves: the entrypoint's `tau serve` says hello over HTTP, and serves the page.

Run by the image's `verify` stage. No model is contacted. The protocol is read from the
generated.ts this image's web client was built from, so a τ and a client that disagree fail here
rather than in a browser.

It runs the image's own entrypoint, flags and all, rather than a `tau serve` of its own: what is
under test is what `docker run` starts. The token is read from the 0600 serve record τ writes in
~/.tau/serve/, the same record `tau serve -d --json` prints.
"""

from __future__ import annotations

import http.client
import json
import re
import subprocess
import sys
import time
from pathlib import Path

PORT = 8256
GENERATED = Path("/opt/tau-code/generated.ts")
RECORDS = Path.home() / ".tau" / "serve"


def fail(message: str) -> None:
    print(f"verify: {message}", file=sys.stderr)
    sys.exit(1)


match = re.search(r"export const PROTOCOL = (\d+)", GENERATED.read_text())
if not match:
    fail(f"{GENERATED} exports no PROTOCOL.")
protocol = int(match.group(1))


def events(response: http.client.HTTPResponse):
    """Server-sent events off GET /stream, as (event, data)."""
    kind, data = "message", []
    while True:
        line = response.readline().decode().rstrip("\r\n")
        if line == "":
            if data:
                yield kind, "\n".join(data)
            kind, data = "message", []
        elif line.startswith(":"):
            continue
        elif line.startswith("event:"):
            kind = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))


server = subprocess.Popen(["/usr/local/bin/tau-code-entrypoint"], stdout=subprocess.PIPE, text=True)
try:
    deadline = time.monotonic() + 30
    record = None
    while record is None:
        if server.poll() is not None:
            fail(f"the entrypoint exited {server.returncode}: {server.stdout.read() if server.stdout else ''}")
        for path in RECORDS.glob("*.json") if RECORDS.exists() else []:
            candidate = json.loads(path.read_text())
            if candidate.get("pid") == server.pid and candidate.get("token"):
                record = candidate
        if record is None:
            if time.monotonic() > deadline:
                fail("no serve record for the entrypoint's server within 30s.")
            time.sleep(0.2)

    if record.get("host") != "0.0.0.0" or record.get("port") != PORT:
        fail(f"the server listens on {record.get('host')}:{record.get('port')}, not 0.0.0.0:{PORT}.")
    auth = {"Authorization": f"Bearer {record['token']}"}

    stream = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    stream.request("GET", "/stream", headers={**auth, "Accept": "text/event-stream"})
    response = stream.getresponse()
    if response.status != 200:
        fail(f"GET /stream: HTTP {response.status}")
    feed = events(response)
    kind, connection = next(feed)
    if kind != "connection":
        fail(f"the stream began with {kind!r}")
    hello = {"jsonrpc": "2.0", "id": 1, "method": "hello", "params": {"protocol": protocol, "client": "verify"}}
    post = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    post.request("POST", f"/stream/{connection}", body=json.dumps(hello), headers={**auth, "Content-Type": "application/json"})
    posted = post.getresponse()
    posted.read()
    if posted.status != 202:
        fail(f"POST /stream/{connection}: HTTP {posted.status}")
    answer = None
    for kind, data in feed:
        message = json.loads(data) if kind == "message" else {}
        if message.get("id") == 1:
            answer = message
            break
    if answer is None:
        fail("the stream ended without an answer to hello.")
    if "error" in answer:
        fail(f"hello was refused: {answer['error']}")
    result = answer.get("result") or {}
    print(f"verify: tau serve {record.get('version', '?')} on 0.0.0.0:{PORT} said hello at protocol {result.get('protocol')}.")

    # A browser on the host sees the page at the published address, not at 0.0.0.0: the
    # entrypoint's default origins must be let in, and any other refused.
    for origin, wanted in (("http://127.0.0.1:8256", 200), ("http://localhost:8256", 200), ("http://elsewhere.example", 403)):
        probe = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
        probe.request("GET", "/stream", headers={**auth, "Accept": "text/event-stream", "Origin": origin})
        status = probe.getresponse().status
        probe.close()
        if status != wanted:
            fail(f"GET /stream from Origin {origin}: HTTP {status}, wanted {wanted}.")
    print("verify: pages from http://127.0.0.1:8256 and http://localhost:8256 may call /stream; others are refused.")

    page = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    page.request("GET", "/")
    body = page.getresponse().read().decode()
    if 'id="root"' not in body:
        fail("GET / did not answer with the web client's page.")
    print("verify: GET / serves this image's web client.")
finally:
    server.terminate()
    server.wait(timeout=10)
