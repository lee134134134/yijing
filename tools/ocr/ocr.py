#!/usr/bin/env python3
"""
PDF OCR(macOS 渲染 + RapidOCR)

- 渲染:调用 tools/ocr/ocr --render-only(macOS PDFKit,无需 poppler)
- 识别:RapidOCR(中文竖排/横排均可),按阅读顺序拼接
- 断点续跑:已存在的 page-XXXX.txt 跳过

用法:
  python3 tools/ocr/ocr.py --pdf <pdf> --out <txt-dir> --images <png-dir> [--pages 1-10] [--width 1800]
"""

import argparse
import subprocess
import sys
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR

ROOT = Path(__file__).resolve().parents[2]
RENDER_BIN = ROOT / "tools" / "ocr" / "ocr"


def order_text(result) -> str:
    if not result:
        return ""

    items = []
    for box, text, score in result:
        if not text or float(score) < 0.3:
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        items.append(
            {
                "x": min(xs),
                "y": min(ys),
                "w": max(xs) - min(xs),
                "h": max(ys) - min(ys),
                "text": text,
                "score": float(score),
            }
        )

    if not items:
        return ""

    vertical = sum(1 for item in items if item["h"] > item["w"] * 1.5) > len(items) / 2
    if vertical:
        # 竖排:右列优先,同列自上而下(按 24px 分箱,避免同列抖动)
        items.sort(key=lambda item: (-round(item["x"] / 24), item["y"]))
    else:
        items.sort(key=lambda item: (round(item["y"] / 12), item["x"]))

    return "\n".join(item["text"] for item in items)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--pages", default="")
    parser.add_argument("--width", type=int, default=1800)
    args = parser.parse_args()

    out_dir = Path(args.out)
    image_dir = Path(args.images)
    out_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)

    render_cmd = [
        str(RENDER_BIN),
        args.pdf,
        str(image_dir),
        str(args.width),
        "--render-only",
    ]
    if args.pages:
        render_cmd += ["--pages", args.pages]

    print(f"[ocr] rendering {args.pdf} -> {image_dir}", flush=True)
    subprocess.run(render_cmd, check=True)

    pages = sorted(image_dir.glob("page-*.png"))
    print(f"[ocr] pages={len(pages)}", flush=True)

    engine = RapidOCR()
    done = 0
    skipped = 0
    for page in pages:
        target = out_dir / f"{page.stem}.txt"
        if target.exists() and target.stat().st_size > 0:
            skipped += 1
            continue

        result, _ = engine(str(page))
        text = order_text(result)
        target.write_text(text, encoding="utf-8")
        done += 1
        if done % 10 == 0 or done == 1:
            print(f"[ocr] {page.name}: chars={len(text)} done={done} skipped={skipped}", flush=True)

    print(f"[ocr] finished: done={done} skipped={skipped}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
