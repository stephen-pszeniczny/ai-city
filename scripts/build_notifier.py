"""Build the notifier app used for Mac notifications. Safe to re-run.

Run with:  .venv/bin/python scripts/build_notifier.py

It makes build/Asteroid Belt Notifier.app (git-ignored) from helpers/notifier.swift
with the Swift compiler from Apple's Command Line Tools, draws its icon
(helpers/notifier_icon.swift), signs it for this Mac only (ad-hoc), and registers
it with macOS so it may post notifications. Nothing is downloaded.

Notifications show as "Asteroid Belt". The first one makes macOS ask whether to
allow them: click Allow. Re-run this after changing either Swift file.
"""

import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "helpers" / "notifier.swift"
ICON_SOURCE = REPO_ROOT / "helpers" / "notifier_icon.swift"
APP = REPO_ROOT / "build" / "Asteroid Belt Notifier.app"
BUNDLE_ID = "local.asteroidbelt.notifier"
LSREGISTER = Path(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/"
    "LaunchServices.framework/Support/lsregister"
)


def main() -> None:
    if sys.platform != "darwin":
        sys.exit("The notifier only builds on a Mac.")
    swiftc = shutil.which("swiftc")
    swift = shutil.which("swift")
    if swiftc is None or swift is None:
        sys.exit("Swift not found. Install Apple's Command Line Tools first.")

    contents = APP / "Contents"
    if APP.exists():
        shutil.rmtree(APP)
    (contents / "MacOS").mkdir(parents=True)
    (contents / "Resources").mkdir()

    subprocess.run(
        [swiftc, "-O", str(SOURCE), "-o", str(contents / "MacOS" / "notifier")], check=True
    )
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        subprocess.run([swift, str(ICON_SOURCE), str(iconset)], check=True)
        subprocess.run(
            [
                "iconutil",
                "-c",
                "icns",
                str(iconset),
                "-o",
                str(contents / "Resources" / "AppIcon.icns"),
            ],
            check=True,
        )
    info = {
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleName": "Asteroid Belt",
        "CFBundleDisplayName": "Asteroid Belt",
        "CFBundleExecutable": "notifier",
        "CFBundleIconFile": "AppIcon",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": "1",
        "CFBundleShortVersionString": "1.0",
        "LSUIElement": True,
    }
    with (contents / "Info.plist").open("wb") as f:
        plistlib.dump(info, f)

    subprocess.run(["codesign", "--force", "--sign", "-", str(APP)], check=True)
    subprocess.run([str(LSREGISTER), "-f", str(APP)], check=True)
    print(f"Built and registered {APP.relative_to(REPO_ROOT)} (shows as 'Asteroid Belt').")
    print("The first notification asks permission: click Allow.")


if __name__ == "__main__":
    main()
