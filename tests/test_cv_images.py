import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image
from docx import Document
from fastapi.testclient import TestClient
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app import api
from app.cv_images import MAX_IMAGES, MIN_BYTES, extract_cv_images


def _noisy_jpeg(size: int = 220, seed: int = 0) -> bytes:
    """生成一张体积足够大的噪点 JPEG（随机像素难以压缩，稳定超过字节下限）。"""
    img = Image.new("RGB", (size, size))
    pixels = [
        ((x * 7 + seed) % 256, (y * 13 + seed) % 256, ((x + y) * 17 + seed) % 256)
        for y in range(size)
        for x in range(size)
    ]
    img.putdata(pixels)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _tiny_png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (220, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def _pdf_with_images(path: Path, blobs: list[bytes]) -> None:
    c = canvas.Canvas(str(path))
    for index, blob in enumerate(blobs):
        c.drawImage(ImageReader(io.BytesIO(blob)), 40, 400 - index * 240, width=180, height=180)
        c.showPage()
    c.save()


def _docx_with_images(path: Path, blobs: list[bytes]) -> None:
    document = Document()
    for blob in blobs:
        document.add_picture(io.BytesIO(blob))
    document.save(str(path))


class CvImageExtractionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.dest = self.tmp / "cv_images"

    def tearDown(self):
        self._tmp.cleanup()

    def test_extracts_large_image_from_pdf_and_filters_tiny_icon(self):
        photo = _noisy_jpeg()
        self.assertGreater(len(photo), MIN_BYTES)
        pdf_path = self.tmp / "cv.pdf"
        _pdf_with_images(pdf_path, [photo, _tiny_png()])

        records = extract_cv_images([pdf_path], self.dest)

        self.assertEqual(len(records), 1, "tiny icon must be filtered, photo kept")
        record = records[0]
        self.assertTrue(record.filename.startswith("cv_img_001."))
        self.assertIn(record.content_type, {"image/jpeg", "image/png"})
        self.assertGreaterEqual(min(record.width, record.height), 64)
        self.assertTrue((self.dest / record.filename).is_file())

    def test_duplicate_images_are_deduplicated(self):
        photo = _noisy_jpeg(seed=3)
        pdf_path = self.tmp / "dup.pdf"
        # 同一张图在两页各出现一次，pypdf 会给出两份相同字节
        _pdf_with_images(pdf_path, [photo, photo])

        records = extract_cv_images([pdf_path], self.dest)

        self.assertEqual(len(records), 1)

    def test_extracts_from_docx(self):
        photo = _noisy_jpeg(seed=7)
        docx_path = self.tmp / "cv.docx"
        _docx_with_images(docx_path, [photo])

        records = extract_cv_images([docx_path], self.dest)

        self.assertEqual(len(records), 1)
        self.assertTrue((self.dest / records[0].filename).is_file())

    def test_missing_and_unsupported_files_return_empty(self):
        (self.tmp / "notes.txt").write_text("not a document", encoding="utf-8")
        records = extract_cv_images(
            [self.tmp / "missing.pdf", self.tmp / "notes.txt"], self.dest
        )
        self.assertEqual(records, [])

    def test_image_count_is_capped(self):
        pdf_path = self.tmp / "many.pdf"
        c = canvas.Canvas(str(pdf_path))
        for index in range(MAX_IMAGES + 3):
            c.drawImage(
                ImageReader(io.BytesIO(_noisy_jpeg(size=120, seed=index))),
                40,
                400,
                width=100,
                height=100,
            )
            c.showPage()
        c.save()

        records = extract_cv_images([pdf_path], self.dest)
        self.assertEqual(len(records), MAX_IMAGES)


class CvImageEndpointTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.client = TestClient(api.app)
        self.upload_id = "upl_endpoint_test"
        photo = _noisy_jpeg(seed=11)
        image_dir = self.tmp / self.upload_id / "cv_images"
        image_dir.mkdir(parents=True)
        (image_dir / "cv_img_001.jpeg").write_bytes(photo)
        self._patch = mock.patch.object(api, "UPLOAD_DIR", self.tmp)
        self._patch.start()
        api._UPLOADS[self.upload_id] = {
            "paths": [],
            "cv_images": [
                {
                    "filename": "cv_img_001.jpeg",
                    "content_type": "image/jpeg",
                    "bytes": len(photo),
                    "url": f"/api/uploads/{self.upload_id}/cv-images/cv_img_001.jpeg",
                }
            ],
        }

    def tearDown(self):
        api._UPLOADS.pop(self.upload_id, None)
        self._patch.stop()
        self._tmp.cleanup()

    def test_serves_registered_image(self):
        response = self.client.get(
            f"/api/uploads/{self.upload_id}/cv-images/cv_img_001.jpeg"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/jpeg")

    def test_unknown_and_traversal_filenames_are_rejected(self):
        unknown = self.client.get(
            f"/api/uploads/{self.upload_id}/cv-images/not_registered.png"
        )
        self.assertEqual(unknown.status_code, 404)

        traversal = self.client.get(
            f"/api/uploads/{self.upload_id}/cv-images/..%2F..%2Fsecret.jpeg"
        )
        self.assertEqual(traversal.status_code, 404)


if __name__ == "__main__":
    unittest.main()
