# 系统架构与模块关系

## 1. 运行链路

```text
浏览器
  -> Next.js /api/* rewrite
  -> FastAPI app/api.py
  -> app/parser.py
       -> pypdf / python-docx
       -> app/ocr.py（扫描 PDF 回退）
  -> app/extractor.py
       -> DeepSeek
       -> contracts/schema.json
  -> app/verify.py
       -> Crossref / OpenAlex
       -> app/search.py
  -> 返回并缓存候选人档案
```

档案生成后，`POST /api/qa` 会把档案证据编号后交给模型，模型只能返回证据编号，
最终证据对象由后端从原档案取回，避免模型伪造来源。

## 2. 后端模块

| 模块 | 职责 |
|---|---|
| `app/main.py` | Uvicorn 入口 |
| `app/api.py` | HTTP 端点、上传限制、进程内档案存储 |
| `app/parser.py` | PDF/DOCX 到带页码文本 |
| `app/ocr.py` | PDF 页面渲染与 Tesseract OCR |
| `app/extractor.py` | 分阶段抽取、压缩、缓存与 schema 校验 |
| `app/verify.py` | 论文和非论文声明核验 |
| `app/search.py` | 网页搜索适配层 |
| `app/qa.py` | 证据索引与档案问答 |
| `app/interview_questions.py` | 从档案 claim 生成英文问题集 |
| `app/interview_media.py` | 视频探测、本地英文 ASR 与客观语流指标 |
| `app/interview_analysis.py` | segment ID 对齐、上下文限长的逐题分析 |
| `app/interview_store.py` | 问题集、任务状态和报告的 SQLite 存储 |
| `app/interview_service.py` | 分片上传与异步面试分析编排 |
| `app/interview_api.py` | 视频面试 HTTP 路由 |

## 3. 前端模块

| 模块 | 职责 |
|---|---|
| `frontend/app/page.tsx` | 上传、分析、档案展示和交互主界面 |
| `frontend/app/interview/[profileId]/page.tsx` | 问题生成、视频上传、分析状态和报告主流程 |
| `frontend/components/interview/InterviewReportView.tsx` | 视频播放器、时间戳 inventory 与逐题报告 |
| `frontend/lib/interview.ts` | 面试 TypeScript 契约、分片上传与页面状态恢复 |
| `frontend/app/methodology/page.tsx` | 证据规则说明 |
| `frontend/components/*` | 区块、标签、证据徽章、证据列表和详情弹窗 |
| `frontend/lib/api.ts` | HTTP 请求封装 |
| `frontend/lib/types.ts` | 与数据契约和 API 对齐的 TypeScript 类型 |
| `frontend/lib/mock.ts` | 离线演示档案 |
| `frontend/lib/labels.ts` | 枚举展示文案 |
| `frontend/next.config.ts` | 本地 `/api` 代理 |

## 4. 契约与漂移风险

- `contracts/schema.json` 是档案契约的权威来源。
- `contracts/interview.schema.json` 是问题集和面试报告的权威来源。
- `docs/api.md` 是 HTTP 契约的权威来源。
- `frontend/lib/types.ts` 是手工同步的 TypeScript 映射。
- `app/extractor.py` 在运行时加载 `contracts/schema.json`。
- `tests/test_schema_contract.py` 与 `tests/test_schema_validation.py` 保护结构和边界。

修改上述契约时，代码、类型、测试、示例和文档必须在同一个 PR 中更新。

## 5. 数据边界

- 源码、契约、测试和脱敏样例进入 Git。
- 真实候选材料只放在本地 `data/private/`。
- 上传文件和抽取缓存只放在 `.cache/`。
- `data/samples/` 中的二进制合成或脱敏样本默认不进入 Git。
