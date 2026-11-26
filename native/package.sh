#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: sh native/package.sh /path/to/application.app" >&2
    exit 1
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$here")
app=$1
if [ -e "$app" ]; then
    echo "The destination already exists. Choose a new path." >&2
    exit 1
fi

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
install -m 644 "$here/AppInfo.plist" "$app/Contents/Info.plist"
install -m 755 "$here/OperationsLab" "$app/Contents/MacOS/OperationsLab"
install -m 644 "$here/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
ditto "$root/ui" "$app/Contents/Resources/ui"
codesign --force --sign - "$app"
