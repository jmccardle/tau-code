"""`python -m tau_web [TAU]`: exit 0 if this client and τ speak the same protocol, 1 if not."""

import sys

from tau_web import CLIENT_VERSION, ProtocolMismatch, check

try:
    protocol = check(sys.argv[1] if len(sys.argv) > 1 else None)
except ProtocolMismatch as error:
    sys.exit(f"tau_web: {error}")
print(f"tau_web: tau-code {CLIENT_VERSION} web client and τ both speak protocol {protocol}")
