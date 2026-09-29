import os
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app import ocr
from app.parser import parse_pdf


FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"


def _text_image() -> Image.Image:
    font = ImageFont.truetype(FONT_PATH, 48)
    image = Image.new("RGB", (1400, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.text((80, 80), "John Doe", font=font, fill="black")
    draw.text((80, 200), "PhD in Computer Science", font=font, fill="black")
    draw.text((80, 320), "Publications 2026", font=font, fill="black")
    return image


class OcrTests(unittest.TestCase):
    def test_ocr_image_reads_clear_english_text(self):
        text = ocr.ocr_image(_text_image(), languages=["eng"])
        self.assertIn("John Doe", text)
        self.assertIn("Computer Science", text)

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
