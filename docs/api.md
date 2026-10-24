# 后端 API 契约（Backend API Contract）

本文档定义候选人简历分析系统的后端接口。所有结构化数据均遵循
[`schema.json`](../contracts/schema.json) 的数据契约，未在 schema 中声明的字段一律不接受。

## 概述（Overview）

| 项 | 值 |
|---|---|
| 技术栈 | Python + FastAPI + DeepSeek API |
| Base URL | `http://localhost:8000` |
| 内容格式 | JSON，`Content-Type: application/json` |
| 文件上传格式 | 小文件用 `multipart/form-data`；大文件用 `application/octet-stream` 分片 |
| 文档上限 | 每次上传最多 4 份（PDF 或 DOCX），单文件默认 100 MB |

### 扫描件预处理（OCR）

扫描版或纯图片 PDF（没有文字层）无法直接读取文字。后端在解析时会自动对这类页面
做光学字符识别（Optical Character Recognition, OCR），默认识别简体中文
（chi_sim）与英文（eng）。运行环境需安装 Tesseract 与 Poppler：

```bash
# macOS
brew install tesseract tesseract-lang poppler
```

可通过环境变量 `OCR_LANGUAGES`、`OCR_DPI`、`TESSERACT_CMD` 覆盖默认配置。

### 外部核验与网页搜索（Web Search）

外部核验（external verification）按声明类型分层：

- **论文 / 发表（publication）**：用 Crossref 与 OpenAlex（均免费、无需 key）精确
  核验标题与年份，可自动判定 `confirmed` / `conflict` / `not_found_public`。
- **非论文声明（奖项 / 经费 / 职位 / 机构等）**：文献数据库无法覆盖，用通用网页搜索
  补充公开线索。当前默认使用 Bing 的 HTML 结果页（`cn.bing.com`，免费、无需 key），
  是「无 key 阶段的过渡方案」，可能有速率限制；后续拿到 Tavily / Brave / Serper 等
  付费 key 时，通过 `WEB_SEARCH_PROVIDER` 切换，无需改动核验逻辑。

网页搜索只能「找公开线索」，不能像文献数据库那样自动认定真伪，因此对这类声明保守地
产出 `to_verify`（附上 top 结果链接与摘要）或 `not_found_public`，交由人工复核，
避免把未证实的声明误判为 `confirmed`。

可通过环境变量覆盖搜索后端：

```bash
# WEB_SEARCH_PROVIDER=bing
# WEB_SEARCH_BASE_URL=https://cn.bing.com/search
```

## 通用约定（Conventions）

### 日期（Dates）

日期遵循 ISO 8601：

- 完整日期：`2026-09-28`
- 年月：`2026-09`
- 仅年份：`2026`
- 无法确定：`null`

### 溯源（Provenance）

每条结论必须携带 `evidence` 证据对象，其中：

- `source`：来源名称（例如 `candidate_cv.pdf`、`IEEE Xplore`）。
- `source_url`：可一键打开的溯源链接；暂时没有链接时必须填 `null`。
- `evidence_status`：`confirmed` / `not_found_public` / `to_verify` / `conflict`。
- `query_date`：读取文档或查询外部来源的日期。

### 错误（Errors）

统一使用 HTTP 状态码。**业务错误**（后端主动抛出的错误）响应体为嵌套结构，
机器可读的 `code` 与人类可读的 `detail` 都在顶层 `detail` 里：

```json
{
  "detail": {
    "code": "validation_error",
    "detail": "可读的错误说明"
  }
}
```

> 说明：FastAPI 框架自身的参数校验失败（例如字段类型错误、缺少必填字段）时，
> 响应体的 `detail` 是**数组**（形如 `[{"type":"...","loc":["body","question"],
> "msg":"...","input":...}]`），与上面的业务错误对象不同。前端需同时兼容：
> `detail` 为数组（框架校验错误）、对象（业务错误）两种形态。

常见状态码：

| 状态码 | 含义 |
|---|---|
| `200` | 成功 |
| `201` | 资源创建成功 |
| `202` | 异步任务已接受或仍在处理中 |
| `404` | 资源不存在 |
| `413` | 上传文件数量或大小超限 |
| `422` | 请求体不符合 schema |
| `409` | 上传分片未齐、正在完成或任务尚未完成 |
| `429` | 活跃分片上传会话过多 |
| `500` | 服务器内部错误 |

业务错误的 `code` 取值见各端点章节；`code` 位于 `detail.code`。

### 缓存（Caching）

`analyze` 的结果按 `upload_id` 缓存。首次调用返回 `202` 并在后台执行；完成后重复
调用会直接返回缓存结果，避免重复消耗 DeepSeek API。

### 健康检查（Health）

| 端点 | 语义 |
|---|---|
| `GET /health/live` | 进程存活检查，成功返回 `200` |
| `GET /health/ready` | Schema、上传目录和 DeepSeek 配置检查；失败返回 `503` |
| `GET /health/dependencies` | 返回外部依赖配置和最近一次真实调用状态 |
| `GET /health` | 兼容旧脚本的存活检查 |

`/health/ready` 和 `/health/dependencies` 不主动调用 DeepSeek 或外部数据源，因此不会
因健康检查产生模型费用。远程依赖在首次真实调用前显示为 `unknown`。

## 端点（Endpoints）

### 1. 上传文档 — `POST /api/upload`

上传候选人材料。一次最多 4 份 PDF / DOCX。

请求（`multipart/form-data`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `files` | file[] | 是 | 1–4 份 PDF 或 DOCX 文档 |

示例（curl）：

```bash
curl -X POST http://localhost:8000/api/upload \
  -F "files=@candidate_cv.pdf" \
  -F "files=@awards.pdf"
```

响应 `201 Created`：

```json
{
  "upload_id": "upl_01J0ABCDEF",
  "documents": [
    {
      "document_id": "doc_01J0ABC",
      "filename": "candidate_cv.pdf",
      "content_type": "application/pdf",
      "size_bytes": 245760,
      "status": "accepted"
    },
    {
      "document_id": "doc_01J0ABD",
      "filename": "awards.pdf",
      "content_type": "application/pdf",
      "size_bytes": 98304,
      "status": "accepted"
    }
  ]
}
```

### 1b. 大文件分片上传

前端在文件总大小超过 8 MB 时自动改用分片上传。默认每片 4 MB，避免 Next.js
代理的请求体缓冲上限导致大文件在到达后端前失败。单文件默认上限为 100 MB，可通过
`MAX_FILE_BYTES` 覆盖。

#### 初始化会话 — `POST /api/upload/init`

```json
{
  "files": [
    {"filename": "candidate_cv.pdf", "total_bytes": 26214400}
  ]
}
```

响应 `201 Created`：

```json
{
  "session_id": "chk_01J0ABCDEF",
  "chunk_size": 4194304,
  "files": [
    {
      "file_index": 0,
      "filename": "candidate_cv.pdf",
      "total_bytes": 26214400,
      "chunk_count": 7
    }
  ]
}
```

请求中的文件名必须在同一会话内唯一。会话默认 1 小时未活动后过期，可通过
`CHUNK_SESSION_TTL_SECONDS` 调整；同时最多保留 32 个活跃会话，可通过
`MAX_CHUNK_SESSIONS` 调整。

#### 上传分片 — `PUT /api/upload/session/{session_id}/files/{file_index}/chunks/{chunk_index}`

请求体为 `application/octet-stream`，每片大小必须与初始化结果一致。响应 `200 OK`：

```json
{
  "session_id": "chk_01J0ABCDEF",
  "file_index": 0,
  "chunk_index": 0,
  "bytes": 4194304,
  "received": 1,
  "chunk_count": 7
}
```

#### 完成上传 — `POST /api/upload/session/{session_id}/complete`

所有分片到齐后调用。服务端校验每个分片的大小，在暂存目录合并后再原子移动到最终
上传目录。响应与 `POST /api/upload` 相同，为 `201 Created`。缺少分片返回
`409 incomplete_upload`，会话仍保留供补传；成功后分片会话立即删除。

### 2. 触发抽取与分析 — `POST /api/analyze`

对已上传的文档异步执行结构化抽取、外部核验与综合评价。首次调用立即返回 `202`，
不会等待外部核验完成，因此不受 Next.js 代理 30 秒超时限制。

请求体：

```json
{
  "upload_id": "upl_01J0ABCDEF"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `upload_id` | string | 是 | 由 `/api/upload` 返回 |

首次提交响应 `202 Accepted`：

```json
{
  "upload_id": "upl_01J0ABCDEF",
  "status": "processing"
}
```

任务进入终态后，`GET /api/analyze/{upload_id}` 或重复调用本接口会返回 `200 OK`
及下方结果信封（`candidate` 遵循 `schema.json`）：

```json
{
  "profile_id": "prf_01J0ZYXWVU",
  "status": "completed",
  "schema_version": "1.0.0",
  "warnings": [],
  "candidate": {
    "basic_info": {
      "name": "张三",
      "institution": "某某大学",
      "position": "副教授",
      "research_interests": ["机器学习", "计算机视觉"],
      "highest_degree": "计算机科学博士",
      "skills": ["Python", "PyTorch"],
      "strengths": ["论文产出稳定"],
      "to_verify": [
        {
          "claim": "博士毕业年份",
          "reason": "简历与学校官网不一致",
          "evidence": [
            {
              "source": "institutional page",
              "source_url": "https://example.edu/profile",
              "evidence": "官网显示 2020 年毕业，简历写 2021 年。",
              "evidence_status": "conflict",
              "query_date": "2026-09-28",
              "source_type": "institutional_page"
            }
          ]
        }
      ],
      "evidence": [
        {
          "source": "candidate_cv.pdf",
          "source_url": null,
          "evidence": "简历首页列出姓名、机构与职位。",
          "evidence_status": "confirmed",
          "query_date": "2026-09-28",
          "page": 1,
          "source_type": "resume"
        }
      ]
    },
    "education_employment": {
      "education": [
        {
          "degree": "博士",
          "field": "计算机科学",
          "institution": "某某大学",
          "advisor": "李教授",
          "start_date": "2016-09",
          "end_date": "2020-06",
          "projects": ["深度学习可解释性研究"],
          "outcomes": ["发表 CCF A 论文 3 篇"],
          "evidence": [
            {
              "source": "candidate_cv.pdf",
              "source_url": null,
              "evidence": "简历教育经历部分。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "page": 2,
              "source_type": "resume"
            }
          ]
        }
      ],
      "employment": []
    },
    "awards_funding": {
      "awards": [
        {
          "name": "优秀青年学者奖",
          "year": 2023,
          "awarding_body": "某某学会",
          "evidence": [
            {
              "source": "某某学会官网",
              "source_url": "https://example.org/award",
              "evidence": "获奖名单页面。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "source_type": "institutional_page"
            }
          ]
        }
      ],
      "funding": [
        {
          "project_name": "多模态视觉理解",
          "funder": "国家自然科学基金",
          "start_date": "2024-01",
          "end_date": "2026-12",
          "amount": 500000,
          "currency": "CNY",
          "role": "PI",
          "evidence": [
            {
              "source": "基金系统",
              "source_url": "https://example.org/grants/1",
              "evidence": "项目立项页面显示负责人为候选人。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "source_type": "institutional_page"
            }
          ]
        }
      ]
    },
    "publications_impact": {
      "publications": [
        {
          "title": "An Example Paper on Vision",
          "year": 2023,
          "author_role": "first_author",
          "venue": "CVPR",
          "venue_type": "conference",
          "ranking": "CCF A",
          "citation_count": 120,
          "citation_query_date": "2026-09-28",
          "code_repository": "https://github.com/example/paper",
          "repository_stars": 350,
          "stars_query_date": "2026-09-28",
          "evidence": [
            {
              "source": "IEEE Xplore",
              "source_url": "https://ieeexplore.ieee.org/document/123456",
              "evidence": "论文页面列出候选人为第一作者。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "source_type": "publisher_page"
            }
          ]
        }
      ],
      "total_citations": 1200,
      "citation_query_date": "2026-09-28"
    },
    "academic_service": {
      "services": [
        {
          "service_type": "program_committee",
          "organization_or_venue": "CVPR",
          "role": "Program Committee Member",
          "start_year": 2024,
          "end_year": 2026,
          "research_areas": ["计算机视觉"],
          "evidence": [
            {
              "source": "CVPR 官网",
              "source_url": "https://cvpr.example.org/pc",
              "evidence": "程序委员会名单包含候选人。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "source_type": "publisher_page"
            }
          ]
        }
      ]
    },
    "overall_evaluation": {
      "summary": "候选人在计算机视觉方向有稳定的论文产出和独立主持项目的能力。",
      "strengths": ["论文影响力较高", "独立主持项目"],
      "risks": ["博士毕业年份需进一步核实"],
      "dimensions": [
        {
          "dimension": "研究能力",
          "assessment": "有多篇 CCF A 论文，研究能力较强。",
          "evidence": [
            {
              "source": "IEEE Xplore",
              "source_url": "https://ieeexplore.ieee.org/document/123456",
              "evidence": "论文及引用数据。",
              "evidence_status": "confirmed",
              "query_date": "2026-09-28",
              "source_type": "publisher_page"
            }
          ]
        }
      ]
    }
  }
}
```

当部分文档无法解析、OCR 依赖不可用或外部核验暂时失败时，任务仍进入终态，查询接口
返回 `200`，`status` 为 `completed_with_warnings`。`warnings` 中每项包含：

| 字段 | 含义 |
|---|---|
| `code` | 机器可读的警告代码 |
| `stage` | `parsing`、`ocr` 或 `verification` |
| `message` | 可执行的修复与重试说明 |
| `retryable` | 是否可以通过重试恢复 |
| `source` | 相关文件名或 `null` |

对应事实不会被静默丢弃。论文声明和网页核验失败会在 `evidence` 中追加
`to_verify` 记录，原因和重试提示写入 `notes`。OCR、PDF 渲染或文档解析失败写入
顶层 `warnings`。所有文档均无可提取文本时，任务状态为 `failed`，`error.code` 为
`no_readable_documents`。

### 2b. 查询分析状态 — `GET /api/analyze/{upload_id}`

| 状态 | HTTP | 说明 |
|---|---|---|
| `pending` | `200` | 文件已上传，尚未提交分析 |
| `processing` | `202` | 后台正在解析、抽取或核验 |
| `completed` | `200` | 全部分析完成 |
| `completed_with_warnings` | `200` | 档案可用，但部分解析或外部核验未完成 |
| `failed` | `200` | 任务进入失败终态，响应包含 `error.code` 与 `error.detail` |

`failed` 使用 `200` 表示作业状态查询成功，避免轮询客户端把作业失败误当作查询接口
故障。再次调用 `POST /api/analyze` 可以重试失败的 `upload_id`。

分析终态响应（`completed` / `completed_with_warnings`）额外携带
`assessment` 字段——DeepSeek 评分结果，结构见下方「评分」一节；
评分失败时为 `null` 并追加 `scoring_unavailable` warning。

### 2c. 档案评分 — `POST /api/score`

对给定档案调用 DeepSeek 打分（评分与可信度解耦）：

- `评分`：DeepSeek 对经历与成果质量打 0–10 分（综合分 + 六大模块，各带一句中文
  优劣点评）；缺失字段按中性处理，不因证据未核验而压低。
- `可信度`：由前端规则算法（来源类型权重 × 证据状态系数）单独计算，本接口不涉及。

请求体：

```json
{
  "candidate": {
    "basic_info": {},
    "education_employment": {},
    "awards_funding": {},
    "publications_impact": {},
    "academic_service": {},
    "overall_evaluation": {}
  }
}
```

响应 `200 OK`：

```json
{
  "assessment": {
    "overall": 7.8,
    "modules": {
      "basic_info": { "score": 7.5, "pros": "……", "cons": "……" },
      "education_employment": { "score": 7.2, "pros": "……", "cons": "……" },
      "awards_funding": { "score": 8.5, "pros": "……", "cons": "……" },
      "publications_impact": { "score": 7.0, "pros": "……", "cons": "……" },
      "academic_service": { "score": 6.5, "pros": "……", "cons": "……" },
      "overall_evaluation": { "score": 7.6, "pros": "……", "cons": "……" }
    }
  }
}
```

评分失败（LLM 服务不可用等）返回 `502`；结果按「模型 + 档案内容」哈希缓存，
重复请求不会重复计费。

### 3. 获取结构化档案 — `GET /api/profile`

返回缓存的结构化档案。

查询参数：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `profile_id` | string | 二选一 | 由 `/api/analyze` 返回 |
| `upload_id` | string | 二选一 | 由 `/api/upload` 返回 |

示例：

```bash
curl "http://localhost:8000/api/profile?profile_id=prf_01J0ZYXWVU"
```

响应 `200 OK`：返回符合 `schema.json` 的档案对象（顶层为 `schema_version` + `candidate`）：

```json
{
  "schema_version": "1.0.0",
  "candidate": {
    "basic_info": {},
    "education_employment": {},
    "awards_funding": {},
    "publications_impact": {},
    "academic_service": {},
    "overall_evaluation": {}
  }
}
```

> 与 `/api/analyze` 的区别：`/api/analyze` 返回操作结果信封
> `{ profile_id, status, schema_version, candidate }`；`/api/profile`
> 只返回可独立校验的档案本体 `{ schema_version, candidate }`，
> 与 `schema.json` 的顶层结构完全一致。

### 4. 问答（加分项） — `POST /api/qa`

基于结构化档案回答自然语言问题，并返回支撑证据。

请求体：

```json
{
  "profile_id": "prf_01J0ZYXWVU",
  "question": "候选人总引用量是多少？"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `profile_id` | string | 是 | 目标档案 |
| `question` | string | 是 | 自然语言问题 |

响应 `200 OK`：

```json
{
  "answer": "候选人总引用量为 1200 次。",
  "confidence": "high",
  "evidence": [
    {
      "source": "IEEE Xplore",
      "source_url": "https://ieeexplore.ieee.org/document/123456",
      "evidence": "论文页面显示引用量 120。",
      "evidence_status": "confirmed",
      "query_date": "2026-09-28",
      "source_type": "publisher_page"
    }
  ]
}
```

实现说明（Implementation notes）：

- 引用防伪：后端先把档案里所有证据统一编号（`E1`、`E2`…）交给模型，模型只能回传
  内部字段 `evidence_ids`；最终响应里的 `evidence` 由后端按编号从档案中**原样取回**，
  因此不会出现「引用一个不存在的来源」。不存在的编号会被直接丢弃。
- 可信度降级：拿不出任何有效证据时，`confidence` 一律降为 `low`；非法取值也回退为
  `low`。
- 只依据档案作答：档案里查不到的问题，返回「档案中没有相关信息」+ `confidence: low` +
  空 `evidence`，不做外部知识补全。档案内部矛盾时要求模型指出矛盾并列出双方证据。
- 最多返回 8 条证据（`MAX_EVIDENCE_REFS`）。

错误：

| 状态码 | `code` | 场景 |
|---|---|---|
| `404` | `not_found` | `profile_id` 不存在 |
| `404` | `not_analyzed` | 档案尚未生成 |
| `422` | `missing_profile_id` / `missing_question` | 缺少 `profile_id` 或 `question` |
| `500` | `qa_failed` | 模型调用失败或返回无法解析的内容 |

实测样例见 `examples/qa/sample_qa_cv01.json`（4 个问题，覆盖事实直答、需要汇总的提问、
档案中不存在的信息、英文提问）。

## 与 schema.json 的关系（Relation to schema.json）

`candidate` 对象的完整字段、枚举与必填规则见
[`schema.json`](../contracts/schema.json)。前端与后端联调时，以 `schema.json` 为准；
任何一方的字段变更须走 PR，由本契约负责人审核。
