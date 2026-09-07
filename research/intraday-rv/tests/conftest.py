"""Test bootstrap.

Two defensive settings so the suite runs from a source tree the current user
cannot write to -- an archive extracted with `sudo`, a read-only checkout, or a
directory under macOS TCC protection (Desktop/Documents/Downloads). Without
them Python raises `PermissionError: Operation not permitted` at *import* time,
while trying to write `__pycache__/*.pyc` beside the module, which looks like a
test failure but is purely a filesystem-permission artefact.
"""

import sys
from pathlib import Path

# Must be set before any `src.*` import so no module writes a .pyc.
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
