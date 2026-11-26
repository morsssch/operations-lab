#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cache=$(mktemp -d "${TMPDIR:-/tmp}/lab-swift.XXXXXX")
trap 'rm -rf "$cache"' EXIT

build_arch() {
    swiftc -swift-version 5 -module-cache-path "$cache" -target "$1-apple-macosx12.0" \
        "$here/Window.swift" -o "$cache/$1"
}

if [ "${1:-}" = "--universal" ]; then
    build_arch arm64
    build_arch x86_64
    lipo -create "$cache/arm64" "$cache/x86_64" -output "$cache/OperationsLab"
    codesign --force --sign - "$cache/OperationsLab"
    install -m 755 "$cache/OperationsLab" "$here/OperationsLab"
else
    arch=$(uname -m)
    build_arch "$arch"
    install -m 755 "$cache/$arch" "$here/OperationsLab"
fi
