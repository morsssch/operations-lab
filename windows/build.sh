#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: sh windows/build.sh /path/to/electron-win32-x64.zip /path/to/OperationsLab-Windows-x64.exe" >&2
    exit 1
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$here")
output_dir=$(CDPATH= cd -- "$(dirname -- "$2")" && pwd)
output="$output_dir/$(basename -- "$2")"
temp=$(mktemp -d "${TMPDIR:-/tmp}/operations-win.XXXXXX")
trap 'rm -rf "$temp"' EXIT

payload="$temp/electron"
unzip -q "$1" -d "$payload"
mv "$payload/electron.exe" "$payload/OperationsLab.exe"
mkdir -p "$payload/resources/app"
cp "$here/main.cjs" "$here/preload.cjs" "$here/package.json" "$payload/resources/app/"
cp -R "$root/ui" "$payload/resources/app/ui"
"${MAKENSIS:-makensis}" "-DOUTPUT=$output" "-DINPUT_FILES=$payload/*.*" "$here/portable.nsi"
