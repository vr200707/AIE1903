# AIE1903 Candidate Document Intelligence

AIE1903 Project 1 将候选人的 CV、Cover Letter、Research Statement 和 Teaching
Statement 转换为结构化、可检索、可追溯证据的候选人档案，并提供面向招聘评审的
Web 界面。

`main` 分支包含当前可运行的全栈实现。本项目面向课程演示与评估，暂未接入生产级
数据库、任务队列和权限体系。

> **课程演示声明：** 当前版本使用进程内存储和后台线程池，不提供生产级鉴权、
> 数据隔离或持久化。请勿上传真实候选人的简历、联系方式或其他敏感材料。
> 需要真实数据时必须先完成 P1/P2 的持久化、访问控制和审计改造。

## 运行状态与数据边界

- `/health/live` 检查进程是否存活。
- `/health/ready` 检查 Schema、上传目录和 DeepSeek 配置，不调用付费模型。
- `/health/dependencies` 展示 OCR、PDF 渲染、DeepSeek、Crossref、OpenAlex 和
  Bing 的配置及最近一次调用状态。
- 外部核验或 OCR 局部失败时，分析会尽量保留已生成档案并返回
  `completed_with_warnings`；受外部核验影响的事实会标记为 `to_verify`。
- 上传文件和抽取缓存只用于本机演示：`.cache/` 与 `data/private/` 不进入 Git。

## 核心能力

- 上传 1 至 4 份 PDF 或 DOCX 文件，单文件默认上限 100 MB。
- 大文件自动按 4 MB 分片上传，绕过 Next.js 代理请求体限制。
- 分析异步执行，通过状态接口轮询结果，避免代理 30 秒超时。
- 提取 PDF 文本和页码；对无文字层页面使用 Tesseract OCR 回退。
- 提取 DOCX 段落和表格内容。
- 使用 DeepSeek 按数据契约抽取六大候选人模块。
- 对抽取结果执行 JSON Schema 校验。
- 使用 Crossref 和 OpenAlex 核验论文声明。
- 使用网页搜索为奖项、经费、职位等非论文声明补充公开线索。
- 展示证据状态、来源链接、原文摘录、页码和查询日期。
- 支持关键词与标签筛选、会话内人工修正和基于证据的档案问答。

## 系统架构

```text
PDF / DOCX
    |
    v
文档解析与 OCR 回退
    |
    v
DeepSeek 分阶段结构化抽取
  - 基础事实模块
  - 论文标题枚举
  - 论文分批补全
    |
    v
JSON Schema 校验
    |
    v
公开来源核验
  - Crossref / OpenAlex
  - 可选网页搜索
    |
    v
FastAPI
    |
    v
Next.js 候选人档案界面
```

更完整的模块关系见 [docs/architecture.md](docs/architecture.md)。

## 技术栈

- 后端：Python 3.12、FastAPI、Pydantic、JSON Schema
- 文档处理：pypdf、python-docx、pdf2image、Tesseract OCR
- 模型：DeepSeek OpenAI-compatible API
- 核验：Crossref、OpenAlex、Bing HTML 搜索
- 前端：Next.js 16、React 19、TypeScript、Tailwind CSS 4
- 测试：Python `unittest` 与前端 ESLint

## 目录结构

```text
app/            FastAPI 后端与处理流水线
frontend/       Next.js Web 客户端
contracts/      权威数据契约
docs/           架构、API、方法、测试和操作文档
examples/       脱敏抽取、核验和问答样例
scripts/        Schema 验证、样本检查和合成数据处理
tests/          后端单元、契约与集成测试
data/           本地私有数据和受控样本目录
```

## 环境要求

- Python 3.12 或更高版本
- Node.js 20 或更高版本
- npm
- DeepSeek API Key
- 公开来源核验所需网络访问
- 可选 OCR 环境：
  - Tesseract OCR
  - 简体中文和英文语言包
  - Poppler（`pdftoppm`）

## 快速开始

### 1. 配置后端

Windows PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

macOS / Linux：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

在 `.env` 中至少配置：

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

启动后端：

```bash
uvicorn app.main:app --reload --port 8000
```

验证服务：

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
```

预期响应：

```json
{"status":"ok"}
```

交互式 API 文档：

```text
http://localhost:8000/docs
```

### 2. 启动前端

```bash
cd frontend
npm ci
npm run dev
```

打开：

```text
http://localhost:3000
```

Next.js 默认把 `/api/*` 代理到 `http://localhost:8000`，本机联调不需要额外配置
CORS。若前端需要连接另一台机器上的后端，在 `frontend/.env.local` 中设置：

```dotenv
NEXT_PUBLIC_API_BASE=http://<backend-host>:8000
```

## API 摘要

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/health/live` | 进程存活检查 |
| `GET` | `/health/ready` | Schema、存储和模型配置检查 |
| `GET` | `/health/dependencies` | 外部依赖配置与最近调用状态 |
| `POST` | `/api/upload` | 上传 PDF/DOCX 并返回 `upload_id` |
| `POST` | `/api/upload/init` | 初始化大文件分片上传会话 |
| `PUT` | `/api/upload/session/{id}/files/{i}/chunks/{j}` | 上传一个文件分片 |
| `POST` | `/api/upload/session/{id}/complete` | 校验并合并分片 |
| `POST` | `/api/analyze` | 异步启动解析、抽取和核验 |
| `GET` | `/api/analyze/{upload_id}` | 查询异步分析状态与结果 |
| `GET` | `/api/profile` | 按 `profile_id` 或 `upload_id` 读取档案 |
| `POST` | `/api/qa` | 基于档案与证据回答问题 |

完整请求、响应和错误约定见 [docs/api.md](docs/api.md)。

## 数据契约

[contracts/schema.json](contracts/schema.json) 是候选人档案的唯一权威契约，当前版本为
`1.0.0`。

候选人档案包含六个模块：

1. `basic_info`
2. `education_employment`
3. `awards_funding`
4. `publications_impact`
5. `academic_service`
6. `overall_evaluation`

每条事实应附带证据对象，记录来源、来源链接、原文摘录、证据状态和查询日期。
`not_found_public` 表示当前未找到公开证据，不代表声明为假。

契约版本和修改规则见 [contracts/README.md](contracts/README.md)。

## 环境变量

| 变量 | 是否必需 | 用途 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 鉴权 |
| `DEEPSEEK_MODEL` | 否 | 模型名，默认 `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | 否 | OpenAI-compatible API 地址 |
| `DEEPSEEK_MAX_OUTPUT_TOKENS` | 否 | 单次模型输出上限，默认 `8192` |
| `EXTRACT_MAX_CONTEXT_CHARS` | 否 | 抽取上下文预算，默认 `60000` |
| `OCR_LANGUAGES` | 否 | OCR 语言，默认 `chi_sim+eng` |
| `OCR_DPI` | 否 | PDF 渲染 DPI，默认 `300` |
| `TESSERACT_CMD` | 否 | Tesseract 可执行文件路径 |
| `WEB_SEARCH_PROVIDER` | 否 | 搜索后端，当前为 `bing` |
| `WEB_SEARCH_BASE_URL` | 否 | 搜索端点覆盖 |
| `VERIFY_MAX_WORKERS` | 否 | 外部核验并发数，默认 `8` |
| `NEXT_PUBLIC_API_BASE` | 否 | 前端代理的后端地址 |

## 测试与检查

安装开发依赖：

```bash
python -m pip install -r requirements-dev.txt
```

运行后端测试：

```bash
python -m unittest discover -v
```

验证契约：

```bash
python -m scripts.schema_validation
```

检查合成样本：

```bash
python -m scripts.check_sample_documents
```

运行前端检查：

```bash
cd frontend
npm run lint
npm run build
```

OCR 测试依赖 Tesseract、语言包和 Poppler。环境未安装这些工具时，相关测试会明确
跳过，而不是把缺失环境误判为业务失败。

测试策略与 schema 边界用例见 [docs/testing.md](docs/testing.md)。

## 样例数据

[examples/](examples/) 保存脱敏的抽取、核验和问答结果，只用于演示与人工比对。

合成 CV 生成器位于：

```text
scripts/fixtures/generate_cv_fixtures.py
```

生成文件默认写入 `data/samples/cv-fixtures-2026-09-29/`。这些二进制样本默认不提交
到 Git。

## 隐私与负责任使用

- 不得提交真实候选人材料、私人联系方式、API Key 或 `.env`。
- 真实材料只放在被忽略的 `data/private/`。
- 每个事实必须尽量保留来源、证据和查询日期。
- 不得静默覆盖冲突证据。
- `not_found_public` 只表示公开来源未确认，不表示声明为假。
- 模型生成的综合评价必须与来源事实分开呈现。

数据目录规则见 [data/README.md](data/README.md)。

## 当前限制

- 上传和档案存储在进程内，并辅以本地上传目录，不适合生产部署。
- `/api/analyze` 使用进程内线程池和内存状态，服务重启或多进程部署时不会保留任务。
- 网页搜索依赖公开 HTML 页面，可能受速率限制或页面结构变化影响。
- OCR 依赖外部的 Tesseract 和 Poppler。
- `frontend/lib/types.ts` 当前由契约手工维护，需要同步更新。
- FastAPI 业务错误仍使用嵌套 `detail` 对象，前端已做兼容。

进一步跟踪见 [docs/known-issues.md](docs/known-issues.md)。

## 文档索引

- [架构与模块关系](docs/architecture.md)
- [API 契约](docs/api.md)
- [方法与证据规则](docs/methodology.md)
- [本地开发与联调](docs/development.md)
- [运行与故障排查](docs/operations.md)
- [测试策略](docs/testing.md)
- [当前已知问题](docs/known-issues.md)
- [历史记录](docs/archive/README.md)

## 协作

1. 从最新 `main` 创建任务分支。
2. 提交前运行相关测试和前端检查。
3. 通过 Pull Request 合并，至少一名队友审查。
4. 不提交缓存、环境文件、真实数据或生成目录。

完整约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
