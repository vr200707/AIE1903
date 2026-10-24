#!/usr/bin/env python3
"""把 NASA 行星照片的黑色背景抠成透明，并导出为前端可用的 PNG sprite。

输入：outputs/score-overview-mockup/assets/{name}.jpg
输出：frontend/public/planets/{name}.png
     outputs/score-overview-mockup/assets/{name}.png（供效果图复用）

原理：
  行星照片背景为纯黑，行星本体/星环亮度较高。
  先用「硬阈值」二值化得到内容掩膜（只保留真正有内容的像素，
  不保留边缘暗色晕圈），再对掩膜做轻微高斯模糊做 1~2px 的抗锯齿羽化。
  这样能消除上一版「亮度渐变 alpha」带来的暗色方框/黑圈。

  裁剪时以内容包围盒为准并额外留出 margin，保证像火星这类
  「行星圆盘几乎贴满整张图」的素材也有透明边距。
"""

from __future__ import annotations

import os
from PIL import Image, ImageFilter


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "outputs", "score-overview-mockup", "assets")
OUT_DIRS = [
    os.path.join(ROOT, "frontend", "public", "planets"),
    SRC_DIR,
]

NAMES = ["earth", "mars", "jupiter", "saturn", "venus", "neptune"]
THRESHOLD = 20        # 亮度阈值：>=20 视为行星内容，<20 视为太空背景
FEATHER_PX = 2        # 边缘羽化半径（抗锯齿）
MARGIN_RATIO = 0.05   # 内容包围盒外额外留白比例
MAX_DIM = 720         # 缩放到最长边 720px，控制前端体积


def extract_sprite(src: str) -> Image.Image:
    """从黑底行星照片中抠出带透明通道的行星贴图。"""
    img = Image.open(src).convert("RGB")
    w, h = img.size

    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p >= THRESHOLD else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError(f"no content found in {src}")

    margin = round(max(w, h) * MARGIN_RATIO)
    left = max(0, bbox[0] - margin)
    top = max(0, bbox[1] - margin)
    right = min(w, bbox[2] + margin)
    bottom = min(h, bbox[3] + margin)

    crop_w = right - left
    crop_h = bottom - top
    pad = margin  # 额外扩一圈透明边，给贴边内容留呼吸空间
    out_w = crop_w + pad * 2
    out_h = crop_h + pad * 2

    rgb = Image.new("RGB", (out_w, out_h), (0, 0, 0))
    rgb.paste(img.crop((left, top, right, bottom)), (pad, pad))
    alpha = Image.new("L", (out_w, out_h), 0)
    alpha.paste(mask.crop((left, top, right, bottom)), (pad, pad))
    alpha = alpha.filter(ImageFilter.GaussianBlur(FEATHER_PX))

    out = rgb.convert("RGBA")
    out.putalpha(alpha)

    ow, oh = out.size
    scale = min(1.0, MAX_DIM / max(ow, oh))
    if scale < 1.0:
        out = out.resize((round(ow * scale), round(oh * scale)), Image.LANCZOS)
    return out


def main() -> None:
    for out_dir in OUT_DIRS:
        os.makedirs(out_dir, exist_ok=True)

    for name in NAMES:
        src = os.path.join(SRC_DIR, f"{name}.jpg")
        sprite = extract_sprite(src)
        for out_dir in OUT_DIRS:
            dst = os.path.join(out_dir, f"{name}.png")
            sprite.save(dst, optimize=True)
            print(f"wrote {dst} ({sprite.size[0]}x{sprite.size[1]})")


if __name__ == "__main__":
    main()
