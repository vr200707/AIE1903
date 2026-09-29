# 后端 API 契约（Backend API Contract）

本文档定义候选人简历分析系统的后端接口。所有结构化数据均遵循
[`schema.json`](./schema.json) 的数据契约，未在 schema 中声明的字段一律不接受。

## 概述（Overview）

| 项 | 值 |
|---|---|
| 技术栈 | Python + FastAPI + DeepSeek API |
| Base URL | `http://localhost:8000` |
| 内容格式 | JSON，`Content-Type: application/json` |
| 文件上传格式 | `multipart/form-data` |
| 文档上限 | 每次上传最多 4 份（PDF 或 DOCX） |

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
| `404` | 资源不存在 |
| `413` | 上传文件数量或大小超限 |
| `422` | 请求体不符合 schema |
| `500` | 服务器内部错误 |

业务错误的 `code` 取值见各端点章节；`code` 位于 `detail.code`。

### 缓存（Caching）

`analyze` 的结果按 `upload_id` 缓存。相同文档重复调用时直接返回缓存结果，
避免重复消耗 DeepSeek API。

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

### 2. 触发抽取与分析 — `POST /api/analyze`

对已上传的文档执行结构化抽取、外部核验与综合评价，返回结构化档案。

请求体：

```json
{
  "upload_id": "upl_01J0ABCDEF"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `upload_id` | string | 是 | 由 `/api/upload` 返回 |

响应 `200 OK`（`candidate` 遵循 `schema.json`，示例见下）：

```json
{
  "profile_id": "prf_01J0ZYXWVU",
  "status": "completed",
  "schema_version": "1.0.0",
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

实测样例见 `outputs/sample_qa_cv01.json`（4 个问题，覆盖事实直答、需要汇总的提问、
档案中不存在的信息、英文提问）。

## 与 schema.json 的关系（Relation to schema.json）

`candidate` 对象的完整字段、枚举与必填规则见
[`schema.json`](./schema.json)。前端与后端联调时，以 `schema.json` 为准；
任何一方的字段变更须走 PR，由本契约负责人审核。
