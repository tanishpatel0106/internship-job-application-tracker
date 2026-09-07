"""Root conftest: loaded before any test module is imported or rewritten.

Sets `sys.dont_write_bytecode` early enough to cover pytest's own assertion
rewriting, which otherwise writes `tests/__pycache__/*.pyc`. Combined with
`-p no:cacheprovider` in pytest.ini, nothing is written into the source tree,
so the suite runs from a read-only or root-owned checkout -- the state an
archive extracted with `sudo` leaves behind.
"""

import sys

sys.dont_write_bytecode = True
