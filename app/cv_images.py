"""CV 内嵌图片提取（D2 辅助模块）。

从上传的 PDF / DOCX 中提取内嵌图片，供前端在候选人姓名旁展示。
设计原则：
- 尽力而为（best-effort）：任何异常都返回空列表，绝不阻断分析主流程；
- 只保留「像照片/插图」的图：PIL 校验可读、尺寸与字节数达到下限，
  过滤掉项目符号、分隔线、页眉小图标等装饰性碎片；
- sha256 去重，数量封顶，文件名全部重新生成，避免路径穿越。
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Sequence

from PIL import Image

# 尺寸 / 体积下限：小于该值的内嵌对象通常是图标或装饰碎片
MIN_SIDE_PX = 64
MIN_BYTES = 6 * 1024
# 单个档案最多保留的图片数，避免超大 CV 把存储与界面撑爆
MAX_IMAGES = 8
# 统一转存的格式：带透明通道用 PNG，其余用 JPEG 控制体积
JPEG_QUALITY = 88
SUPPORTED_SUFFIXES = {".pdf", ".docx"}


@dataclass
class CvImageRecord:
    """提取并落盘后的单张图片元数据。"""

    filename: str
    content_type: str
    bytes: int
    width: int
    height: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalise_image(raw: bytes) -> tuple[bytes, str, str, int, int] | None:
    """校验并规范化一张图片，返回 (字节, 扩展名, content_type, 宽, 高)。"""
    if len(raw) < MIN_BYTES:
        return None
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.load()
            width, height = img.size
            if min(width, height) < MIN_SIDE_PX:
                return None
            buffer = io.BytesIO()
            if img.mode in {"RGBA", "LA", "P"}:
                converted = img.convert("RGBA")
                converted.save(buffer, format="PNG", optimize=True)
                ext, content_type = "png", "image/png"
            else:
                converted = img.convert("RGB")
                converted.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
                ext, content_type = "jpeg", "image/jpeg"
    except Exception:
        return None
    data = buffer.getvalue()
    if len(data) < MIN_BYTES:
        return None
    return data, ext, content_type, width, height


def _extract_pdf(path: Path) -> list[bytes]:
    """用 pypdf 取出 PDF 各页的内嵌图原始字节。"""
    from pypdf import PdfReader

    blobs: list[bytes] = []
    reader = PdfReader(str(path))
    for page in reader.pages:
        try:
            page_images = list(page.images)
        except Exception:
            # 单页解析失败不影响其他页
            continue
        for embedded in page_images:
            try:
                blobs.append(embedded.data)
            except Exception:
                continue
    return blobs


def _extract_docx(path: Path) -> list[bytes]:
    """用 python-docx 遍历文档关系部件，取出所有嵌入图片的字节。"""
    from docx import Document

    document = Document(str(path))
    blobs: list[bytes] = []
    for rel in document.part.rels.values():
        if "image" not in rel.reltype:
            continue
        try:
            blobs.append(rel.target_part.blob)
        except Exception:
            continue
    return blobs


def extract_cv_images(
    paths: Sequence[str | Path],
    dest_dir: str | Path,
) -> list[CvImageRecord]:
    """从上传文档中提取图片并落盘到 dest_dir，返回元数据列表。

    任何异常都由本函数内部消化，返回空列表；调用方无需再包 try。
    """
    dest = Path(dest_dir)
    try:
        dest.mkdir(parents=True, exist_ok=True)
        raw_blobs: list[bytes] = []
        for raw_path in paths:
            path = Path(raw_path)
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
                continue
            try:
                if path.suffix.lower() == ".pdf":
                    raw_blobs.extend(_extract_pdf(path))
                else:
                    raw_blobs.extend(_extract_docx(path))
            except Exception:
                # 单个文档失败不影响其他文档
                continue

        records: list[CvImageRecord] = []
        seen_hashes: set[str] = set()
        for blob in raw_blobs:
            if len(records) >= MAX_IMAGES:
                break
            normalised = _normalise_image(blob)
            if normalised is None:
                continue
            data, ext, content_type, width, height = normalised
            digest = hashlib.sha256(data).hexdigest()
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            filename = f"cv_img_{len(records) + 1:03d}.{ext}"
            (dest / filename).write_bytes(data)
            records.append(
                CvImageRecord(
                    filename=filename,
                    content_type=content_type,
                    bytes=len(data),
                    width=width,
                    height=height,
                )
            )
        return records
    except Exception:
        return []
