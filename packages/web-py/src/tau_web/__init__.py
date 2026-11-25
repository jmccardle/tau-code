"""tau-code's web client, built: `dist/` is what `tau serve` serves at `/` (it finds this package
by name, `tau_web`, and needs `dist/index.html`).

`PROTOCOL` is the wire protocol the client speaks; `CLIENT_VERSION` is the tau-code version it was
built from. `check()` (or `python -m tau_web`) compares `PROTOCOL` with the τ installed beside it.
"""

import json
import shutil
import subprocess
import sysconfig
from pathlib import Path
from typing import Final

from tau_web._built import CLIENT_VERSION, PROTOCOL

__all__ = ["CLIENT_VERSION", "DIST", "PROTOCOL", "ProtocolMismatch", "check", "tau_protocol"]

DIST: Final = Path(__file__).parent / "dist"
"""The built client: `index.html` and its assets."""


class ProtocolMismatch(RuntimeError):
    """The client and the installed τ speak different protocols, or there is no τ to ask."""


def tau_protocol(tau: str | None = None) -> int:
    """The protocol of the τ at `tau`, else the `tau` beside this interpreter, else on PATH: the
    `x-protocol` of what `tau serve --schema` prints. `ProtocolMismatch` if there is none."""
    found = tau or shutil.which("tau", path=sysconfig.get_path("scripts")) or shutil.which("tau")
    if found is None:
        raise ProtocolMismatch("no `tau` beside this Python or on PATH: install ffwf-tau")
    printed = subprocess.run(
        [found, "serve", "--schema"], capture_output=True, text=True, check=True, timeout=60
    ).stdout
    protocol = json.loads(printed).get("x-protocol")
    if not isinstance(protocol, int):
        raise ProtocolMismatch(f"`{found} serve --schema` names no x-protocol")
    return protocol


def check(tau: str | None = None) -> int:
    """The protocol both speak; `ProtocolMismatch` if τ's is not `PROTOCOL`."""
    theirs = tau_protocol(tau)
    if theirs != PROTOCOL:
        raise ProtocolMismatch(
            f"this web client (tau-code {CLIENT_VERSION}) speaks protocol {PROTOCOL}, "
            f"the installed τ speaks {theirs}: install the ffwf-tau-web that pairs with your ffwf-tau"
        )
    return PROTOCOL
