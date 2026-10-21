"""端到端验证脚本：分片上传大文件 + 异步 analyze + 小文件 multipart。

- 仅针对本地上传协议做字节级完整性验证，不依赖真实 DeepSeek/Bing。
- 运行前提：后端已在 127.0.0.1:8000 启动（uvicorn app.main:app）。
- 退出码：全部通过为 0，任一断言失败为非 0。
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

import httpx

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000")
ROOT = Path(__file__).resolve().parents[1]
CHUNK_SIZE = 4 * 1024 * 1024


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def big_pdf(size: int) -> bytes:
    # 生成确定性的伪 PDF 字节；上传阶段不解析内容，只校验字节一致。
    body = bytearray()
    i = 0
    while len(body) < size:
        body.extend(f"page-{i}\n".encode())
        i += 1
    return bytes(body[:size])


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f"  ({detail})" if detail else ""))
    if not cond:
        raise SystemExit(1)


def main() -> None:
    client = httpx.Client(base_url=BASE, timeout=30.0)

    # Next rewrites 只转发 /api/*，/health 不在代理面内；直连后端时才检查。
    if "127.0.0.1:8000" in BASE:
        r = client.get("/health")
        check("health", r.status_code == 200 and r.json().get("status") == "ok")

    # 1) 大文件分片上传：25MB，远超 Next 代理 10MB 缓冲上限
    size = 25 * 1024 * 1024
    payload = big_pdf(size)
    r = client.post(
        "/api/upload/init",
        json={"files": [{"filename": "big.pdf", "total_bytes": size}]},
    )
    check("chunk init 201", r.status_code == 201, f"got {r.status_code}")
    init = r.json()
    session_id = init["session_id"]
    chunk_count = init["files"][0]["chunk_count"]
    check("chunk_count=7", chunk_count == 7, f"got {chunk_count}")

    for i in range(chunk_count):
        start = i * CHUNK_SIZE
        end = min(start + CHUNK_SIZE, size)
        r = client.put(
            f"/api/upload/session/{session_id}/files/0/chunks/{i}",
            content=payload[start:end],
            headers={"Content-Type": "application/octet-stream"},
        )
        check(f"chunk {i} 200", r.status_code == 200, f"got {r.status_code}")

    r = client.post(f"/api/upload/session/{session_id}/complete")
    check("chunk complete 201", r.status_code == 201, f"got {r.status_code}: {r.text}")
    upload_id = r.json()["upload_id"]

    stored = (ROOT / ".cache" / "uploads" / upload_id / "big.pdf").read_bytes()
    check(
        "big file byte-identical",
        stored == payload and sha256(stored) == sha256(payload),
        f"{len(stored)} bytes",
    )
    check(
        "chunk session cleaned up",
        not (ROOT / ".cache" / "uploads" / ".chunks" / session_id).exists(),
    )

    # 2) analyze 应立刻返回 202（异步），不阻塞、不超时
    r = client.post("/api/analyze", json={"upload_id": upload_id})
    check("analyze async 202", r.status_code == 202, f"got {r.status_code}")

    # 3) 轮询到终态。伪 PDF 无法解析，预期后端把分析标记为 failed，
    #    GET /api/analyze/{id} 对 failed 返回 500（与单测契约一致），
    #    这里只要求“进入终态、不卡在 processing”即可。
    final_status = None
    for _ in range(50):
        time.sleep(0.2)
        r = client.get(f"/api/analyze/{upload_id}")
        if r.status_code == 500:
            final_status = "failed"
            break
        final_status = r.json().get("status")
        if final_status in ("completed", "partial"):
            break
    check(
        "analyze reaches terminal state",
        final_status in ("completed", "partial", "failed"),
        str(final_status),
    )

    # 4) 小文件 multipart 路径仍可用
    r = client.post(
        "/api/upload",
        files={"files": ("small.pdf", b"%PDF-1.4 placeholder", "application/pdf")},
    )
    check("small multipart 201", r.status_code == 201, f"got {r.status_code}")

    print("ALL E2E CHECKS PASSED")


if __name__ == "__main__":
    main()
