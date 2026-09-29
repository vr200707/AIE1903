"""OCR（光学字符识别）模块：把「扫描版 / 纯图片」PDF 转成可检索文本。

背景：pypdf 只能读取 PDF 中已经存在的「文字层」。扫描件（例如 cv_09_scanned_image_only）
本质是一张照片，PDF 里没有文字层，因此 pypdf 提取到 0 个字符。OCR 的工作是：
  1. 把 PDF 每一页渲染成图片（用 Poppler 的 pdftoppm）；
  2. 用 Tesseract 识别图片里的文字，支持简体中文（chi_sim）与英文（eng）。

设计要点：
- 只在「该页没有文字层」时才做 OCR，避免对普通 PDF 浪费时间与算力。
- 语言、DPI、Tesseract 路径均可通过环境变量覆盖，缺省值对常见简历足够。
- 明确区分「环境没装好」与「识别失败」两类错误，方便上层给出可读提示。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytesseract
from pdf2image import convert_from_path
from PIL import Image


def _tesseract_cmd() -> str:
    return os.getenv("TESSERACT_CMD", "tesseract")


def ocr_languages() -> list[str]:
    """返回 Tesseract 语言列表，例如 ['chi_sim', 'eng']。"""
    raw = os.getenv("OCR_LANGUAGES", "chi_sim+eng")
    return [part.strip() for part in raw.split("+") if part.strip()]


def ocr_dpi() -> int:
    return int(os.getenv("OCR_DPI", "300"))


def _ensure_tesseract() -> str:
    cmd = _tesseract_cmd()
    try:
        pytesseract.get_tesseract_version()
    except Exception as exc:  # pytesseract.TesseractNotFoundError 等
        raise RuntimeError(
            f"Tesseract executable not found ({cmd}). Install it first: "
            "macOS: `brew install tesseract tesseract-lang`, "
            "Linux: `sudo apt install tesseract-ocr tesseract-ocr-chi-sim`."
        ) from exc
    return cmd


def render_pdf_pages(
    path: str | Path,
    *,
    dpi: int | None = None,
    page_numbers: list[int] | None = None,
) -> list[Image.Image]:
    """把 PDF 渲染成 PIL 图片列表，可只渲染指定页码（1-based）。"""
    path = Path(path)
    dpi = dpi or ocr_dpi()
    first_page = None
    last_page = None
    if page_numbers:
        first_page = min(page_numbers)
        last_page = max(page_numbers)
    try:
        images = convert_from_path(
            str(path),
            dpi=dpi,
            first_page=first_page,
            last_page=last_page,
            fmt="png",
        )
    except Exception as exc:
        raise RuntimeError(
            f"Unable to render PDF pages. Poppler / pdftoppm is required: {exc}"
        ) from exc
    return list(images)


def ocr_image(
    image: Image.Image,
    *,
    languages: list[str] | None = None,
) -> str:
    """识别单张图片，返回纯文本。"""
    _ensure_tesseract()
    langs = languages or ocr_languages()
    text = pytesseract.image_to_string(image, lang="+".join(langs))
    return (text or "").strip()


def ocr_pdf_pages(
    path: str | Path,
    *,
    languages: list[str] | None = None,
    dpi: int | None = None,
) -> list[str]:
    """对整份 PDF 逐页 OCR，返回按页码顺序排列的文本列表。"""
    path = Path(path)
    dpi = dpi or ocr_dpi()
    langs = languages or ocr_languages()
    images = render_pdf_pages(path, dpi=dpi)
    return [ocr_image(image, languages=langs) for image in images]
