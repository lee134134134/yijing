#!/bin/sh
set -e
cd "$(dirname "$0")/../.."
swiftc -O -o tools/ocr/ocr tools/ocr/ocr.swift \
  -framework PDFKit -framework Vision -framework AppKit
echo "built tools/ocr/ocr"
