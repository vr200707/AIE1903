from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app import ocr
from app.parser import parse_pdf


def _candidate_fonts() -> list[str]:
    """按平台返回常见可用字体的候选路径，避免硬编码 macOS 路径。"""
    if sys.platform == "darwin":
        return [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Helvetica.ttc",
        ]
    if os.name == "nt":
        return [
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\Arial.ttf",
            r"C:\Windows\Fonts\calibri.ttf",
        ]
    return [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]


def _find_font() -> str | None:
    for path in _candidate_fonts():
        if Path(path).is_file():
            return path
    return None


FONT_PATH = _find_font()
# OCR 依赖本机字体 + Tesseract；缺任一项时跳过图像类测试，纯逻辑测试照常跑。
OCR_AVAILABLE = FONT_PATH is not None and shutil.which("tesseract") is not None


def _text_image() -> Image.Image:
    font = ImageFont.truetype(FONT_PATH, 48)
    image = Image.new("RGB", (1400, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.text((80, 80), "John Doe", font=font, fill="black")
    draw.text((80, 200), "PhD in Computer Science", font=font, fill="black")
    draw.text((80, 320), "Publications 2026", font=font, fill="black")
    return image


class OcrTests(unittest.TestCase):
    @unittest.skipUnless(OCR_AVAILABLE, "缺少可用字体或 tesseract，跳过 OCR 图像测试")
    def test_ocr_image_reads_clear_english_text(self):
        text = ocr.ocr_image(_text_image(), languages=["eng"])
        self.assertIn("John Doe", text)
        self.assertIn("Computer Science", text)

    @unittest.skipUnless(OCR_AVAILABLE, "缺少可用字体或 tesseract，跳过 OCR 图像测试")
    def test_parse_pdf_falls_back_to_ocr_for_scanned_page(self):
        image = _text_image()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scanned.pdf"
            image.save(path, "PDF", resolution=300.0)
            parsed = parse_pdf(path)

        combined = parsed.full_text()
        self.assertIn("John Doe", combined)
        self.assertIn("Computer Science", combined)

    def test_ocr_languages_from_env(self):
        old = os.environ.get("OCR_LANGUAGES")
        os.environ["OCR_LANGUAGES"] = "chi_sim+chi_tra+eng"
        try:
            self.assertEqual(ocr.ocr_languages(), ["chi_sim", "chi_tra", "eng"])
        finally:
            if old is None:
                os.environ.pop("OCR_LANGUAGES", None)
            else:
                os.environ["OCR_LANGUAGES"] = old


if __name__ == "__main__":
    unittest.main()
