"""开发入口：`uvicorn app.main:app --reload`。"""

from app.api import app


__all__ = ["app"]
