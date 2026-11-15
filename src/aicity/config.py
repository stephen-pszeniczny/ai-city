"""Where the app keeps its data, and other startup settings.

The app's real data never lives in this repo. It lives in a private folder,
by default ~/AI-City-Data. Setting the AICITY_DATA_DIR environment variable
points the app somewhere else, which is how tests use a throwaway folder.
"""

import os
from pathlib import Path

DATA_DIR_ENV = "AICITY_DATA_DIR"
DEFAULT_DATA_DIR_NAME = "AI-City-Data"

# The app only ever listens on this Mac, never the network.
HOST = "127.0.0.1"
PORT = 8765

# While building, the page is served by the Vite dev server on this port.
# Requests from it are accepted only when AICITY_DEV=1 is set.
DEV_PORT = 5173
DEV_ENV = "AICITY_DEV"


def dev_mode() -> bool:
    """True only when AICITY_DEV is exactly '1'."""
    return os.environ.get(DEV_ENV, "").strip() == "1"


def default_data_dir() -> Path:
    """The private data folder used when AICITY_DATA_DIR isn't set."""
    return Path.home() / DEFAULT_DATA_DIR_NAME


def data_dir() -> Path:
    """The data folder in use right now, as an absolute path.

    Read fresh on every call (not cached) so tests can change it safely.
    This only works out the path; it never creates or reads the folder.
    """
    raw = os.environ.get(DATA_DIR_ENV, "").strip()
    path = Path(raw).expanduser() if raw else default_data_dir()
    return path.resolve()
