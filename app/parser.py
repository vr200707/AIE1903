"""文档解析（D2）：PDF / DOCX -> 纯文本 + 页码。

页码用于证据定位（schema.json 中 evidence.page）。PDF 逐页提取文本并保留真实
页码；DOCX 无法可靠获得分页信息，因此整篇返回为单条、页码为 None，上层生成
证据时不填 page 字段。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from docx import Document
from pypdf import PdfReader

from app import health
from app.ocr import render_pdf_pages, ocr_image
from app.resilience import AnalysisWarning, warning


SUPPORTED_SUFFIXES = {".pdf", ".docx"}

CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@dataclass
class PageText:
    """一页（或一个逻辑文本段）的提取结果。"""

    page_number: int | None
    text: str


@dataclass
class ParsedDocument:
    """解析后的文档。"""

    filename: str
    content_type: str
    pages: list[PageText]
    warnings: list[AnalysisWarning] = field(default_factory=list)

    def full_text(self) -> str:
        return "\n".join(page.text for page in self.pages if page.text)


def _normalize_text(text: str | None) -> str:
    return (text or "").strip()


def parse_pdf(path: str | Path) -> ParsedDocument:
    path = Path(path)
    reader = PdfReader(str(path))
    pages: list[PageText] = []
    for index, page in enumerate(reader.pages, start=1):
        pages.append(
            PageText(page_number=index, text=_normalize_text(page.extract_text()))
        )

    # 扫描件没有文字层：对没有文字的页做 OCR，补齐文本。
    empty_numbers = [p.page_number for p in pages if not p.text and p.page_number]
    if empty_numbers:
        first = min(empty_numbers)
        # render_pdf_pages 渲染 first..last 的连续区间，返回按页码升序排列的图片。
        warnings: list[AnalysisWarning] = []
        try:
            images = render_pdf_pages(path, page_numbers=empty_numbers)
            health.record_dependency_success("pdf_renderer")
        except Exception as exc:
            health.record_dependency_failure("pdf_renderer", exc)
            warnings.append(
                warning(
                    "pdf_render_failed",
                    "ocr",
                    (
                        "Pages without a text layer could not be rendered for OCR. "
                        "Install or repair Poppler/pdftoppm, then retry the analysis."
                    ),
                    retryable=True,
                    source=path.name,
                )
            )
            images = []
        by_number = {first + offset: image for offset, image in enumerate(images)}
        for page in pages:
            if page.page_number in by_number and not page.text:
                try:
                    page.text = _normalize_text(
                        ocr_image(by_number[page.page_number])
                    )
                    health.record_dependency_success("ocr")
                except Exception as exc:
                    health.record_dependency_failure("ocr", exc)
                    warnings.append(
                        warning(
                            "ocr_failed",
                            "ocr",
                            (
                                f"OCR failed on page {page.page_number}. Install or "
                                "repair Tesseract and the required language packs, "
                                "then retry the analysis."
                            ),
                            retryable=True,
                            source=path.name,
                        )
                    )
    else:
        warnings = []

    return ParsedDocument(
        filename=path.name,
        content_type=CONTENT_TYPES[".pdf"],
        pages=pages,
        warnings=warnings,
    )


def parse_docx(path: str | Path) -> ParsedDocument:
    path = Path(path)
    doc = Document(str(path))

    chunks: list[str] = []
    for paragraph in doc.paragraphs:
        if paragraph.text.strip():
            chunks.append(paragraph.text.strip())
    # 简历常使用表格排版，遍历表格单元格并合并为一行文本。
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                chunks.append(" | ".join(cells))

    return ParsedDocument(
        filename=path.name,
        content_type=CONTENT_TYPES[".docx"],
        pages=[PageText(page_number=None, text="\n".join(chunks))],
    )


def parse_document(path: str | Path) -> ParsedDocument:
    """按扩展名分派到 PDF 或 DOCX 解析器。"""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(path)
    if suffix == ".docx":
        return parse_docx(path)
    raise ValueError(f"Unsupported document type: {suffix or 'no extension'}")
