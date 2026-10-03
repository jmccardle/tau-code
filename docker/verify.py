"""Prove the image serves: a daemon that says hello, and a page on the same port.

Run by the image's `verify` stage. No model is contacted. The protocol version
is read from the generated.ts this image's web client was built from, so a τ
and a client that disagree fail here rather than in a browser.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from websockets.sync.client import connect

ADDRESS = "127.0.0.1:8256"
GENERATED = Path("/opt/tau-code/generated.ts")


def fail(message: str) -> None:
    print(f"verify: {message}", file=sys.stderr)
    sys.exit(1)


match = re.search(r'PROTOCOL_VERSION = "([^"]+)"', GENERATED.read_text())
if not match:
    fail(f"{GENERATED} names no PROTOCOL_VERSION.")
protocol = match.group(1)

daemon = subprocess.Popen(
    ["tau", "serve", "--listen", ADDRESS, "--web-root", "/opt/tau-code/web"],
    stdout=subprocess.DEVNULL,
)
try:
    deadline = time.monotonic() + 30
    while True:
        try:
            with connect(f"ws://{ADDRESS}/", open_timeout=2) as socket:
                socket.send(json.dumps({"type": "hello", "id": 1, "protocol": protocol, "client": "verify"}))
                answer = json.loads(socket.recv(timeout=10))
            break
        except OSError:
            if time.monotonic() > deadline:
                fail("the daemon did not accept a connection within 30s.")
            time.sleep(0.2)

    if not answer.get("ok"):
        fail(f"hello was refused: {answer.get('error')}")
    result = answer.get("result") or {}
    print(f"verify: tau serve {result.get('version', '?')} said hello at protocol {protocol}.")

    with urllib.request.urlopen(f"http://{ADDRESS}/", timeout=10) as page:
        body = page.read().decode()
    if 'id="root"' not in body:
        fail("GET / did not answer with the web client's page.")
    print("verify: GET / serves the web client.")
finally:
    daemon.terminate()
    daemon.wait(timeout=10)
