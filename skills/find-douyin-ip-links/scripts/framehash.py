#!/usr/bin/env python3
"""把截图/封面图片算成 64 位 dHash，供 families.py 聚类使用（可选工具）。

核心的 families.py 不依赖任何第三方库；本脚本只是为了让"已有截图"能变成指纹，
需要 Pillow。没有 Pillow 时脚本会直接说明安装方式，不会静默产出错误指纹。

用法::

    python3 framehash.py --out fingerprints.json \
        --item 7701162317312036139=cover.png \
        --item 7700897982299819306=frame-3.8s.png

    # 或者一个目录，文件名即 video_id
    python3 framehash.py --out fingerprints.json --dir ./frames

    # 只看单图哈希
    python3 framehash.py --hash cover.png

产出格式与 families.py 的 fingerprints.json 相同（items 数组）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:  # 可选依赖
    from PIL import Image
except ImportError:  # pragma: no cover - 环境相关
    Image = None

SIZE = 9  # 9x8 灰度 → 8 个横向差分 → 64 位


def dhash(path: Path, size: int = SIZE) -> str:
    """对一张图片计算 64 位 dHash，返回 16 位十六进制字符串。"""
    if Image is None:
        raise SystemExit("需要 Pillow 才能从图片算哈希：python3 -m pip install --user pillow")
    with Image.open(path) as im:
        im = im.convert("L").resize((size, size - 1), Image.Resampling.LANCZOS)
        pixels = im.tobytes()  # 'L' 模式：每像素 1 字节，行优先
    bits = 0
    index = 0
    for y in range(size - 1):
        row = y * size
        for x in range(size - 1):
            if pixels[row + x] > pixels[row + x + 1]:
                bits |= 1 << index
            index += 1
    return f"{bits:016x}"


def video_id_from_name(name: str) -> str:
    stem = Path(name).stem
    digits = "".join(ch for ch in stem if ch.isdigit())
    return digits if len(digits) >= 10 else stem


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="图片 → 64 位 dHash 指纹")
    p.add_argument("--out", help="输出 fingerprints.json 路径")
    p.add_argument("--item", action="append", default=[], metavar="VIDEO_ID=IMAGE")
    p.add_argument("--dir", help="目录模式：文件名里的数字串作为 video_id")
    p.add_argument("--creator", default="", help="写入 creator 字段，便于回溯")
    p.add_argument("--hash", help="只算单张图并打印哈希")
    args = p.parse_args(argv)

    if args.hash:
        print(dhash(Path(args.hash)))
        return 0

    pairs: list[tuple[str, Path]] = []
    for raw in args.item:
        if "=" not in raw:
            raise SystemExit(f"--item 需要 VIDEO_ID=IMAGE 形式：{raw}")
        vid, image = raw.split("=", 1)
        pairs.append((vid.strip(), Path(image)))
    if args.dir:
        for file in sorted(Path(args.dir).iterdir()):
            if file.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                pairs.append((video_id_from_name(file.name), file))
    if not pairs:
        raise SystemExit("没有输入；用 --item 或 --dir 指定图片")
    if not args.out:
        raise SystemExit("需要 --out 指定输出文件")

    items = []
    skipped = []
    for vid, image in pairs:
        if not image.exists():
            skipped.append((vid, "文件不存在"))
            continue
        try:
            digest = dhash(image)
        except SystemExit:
            raise
        except Exception as exc:  # 坏图不阻断整批
            skipped.append((vid, str(exc)))
            continue
        items.append(
            {
                "video_id": vid,
                "url": f"https://www.douyin.com/video/{vid}",
                "creator": args.creator or None,
                "duration_seconds": None,
                "text": "",
                "hash": digest,
            }
        )

    Path(args.out).write_text(
        json.dumps({"schema_version": 1, "items": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已写入 {args.out}：{len(items)} 条指纹")
    for vid, why in skipped:
        print(f"[skip] {vid}: {why}", file=sys.stderr)
    return 0 if items else 1


if __name__ == "__main__":
    raise SystemExit(main())
