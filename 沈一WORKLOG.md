# AIE1903 工作日志（沈一 · 后端 & AI 核心）

> 记录方式：按日期追加续写，最新在上；每次只新增日期条目，不改写历史条目。

## 2026-09-30

### 已完成

- D3 信息抽取修复「输出 token 超限」问题（split extraction）。根因：真实简历
  （Jialun Cao，扫描件 OCR 后约 23447 字符、46 篇论文）在单次 DeepSeek 调用里要求
  一次性输出完整 6 模块 JSON，`completion_tokens` 撞上 `deepseek-chat` 的 8192 输出
  上限，`finish_reason=length`，JSON 在 publications 中途被截断，导致解析失败。
- 将 `app/extractor.py` 改为拆分抽取（`EXTRACTION_STRATEGY="split-v1"`），把一次大调用
  拆成三类输出各自都很小的调用：
  1. 基础模块（basic_info / education_employment / awards_funding /
     academic_service / overall_evaluation + publications 汇总字段）；
  2. 论文标题紧凑枚举（仅 title + year）；
  3. 论文明细按标题分批（默认每批 12 篇）补全完整 publication record，合并后按标题去重。
- 缓存 key 纳入「拆分策略 + 每批篇数」，避免与旧单次抽取结果混淆；基础模块仍保留
  schema 校验 + 错误反馈重试，最终整体再走一次完整 schema 校验。
- 实测真实 CV：完整抽取成功，产出 46 篇论文、total_citations=699、education 3 /
  employment 8 / awards 6 / funding 4 / services 19，schema 校验通过，约 57 秒。
- 新增 5 项拆分抽取单测（枚举解析、分批合并、标题去重、缓存 key 区分、端到端编排），
  全仓 57 项测试通过。

### 待办

- 在网页端（localhost:3000）上传真实 CV 走一遍「上传→分析→档案」，确认前端渲染正常。
- 后续真实数据注意：真实候选人 PII 与抽取结果不提交仓库。

## 2026-09-29

### 已完成

- 接入 DeepSeek：token 写入 `.env`（已被 `.gitignore` 忽略，不提交），实测
  `deepseek-chat` 可连通；新增 `.env.example` 模板，requirements 补充
  `jsonschema`（Draft 2020-12 校验）及其依赖。
- D2 文档解析实测：对 9 份样本夹具逐份解析，8 份有文字层的 PDF/DOCX 均正常提取
  文本与页码，`cv_09_scanned_image_only_zh.pdf` 提取 0 字符（无文字层，OCR 边界，
  符合预期）。
- D3 信息抽取：新增 `app/extractor.py`（DeepSeek 批量抽取 + evidence 溯源 + 事实/
  判断分离 + jsonschema 校验 + 磁盘缓存 + 失败自动带错误反馈重试），并补
  `tests/test_extractor.py`（4 项纯逻辑测试）。实测 cv_01 / cv_04 / cv_08 均通过
  schema 校验，样本输出保存到 `outputs/`（cv01 / cv04 / cv08），全仓 12 项测试通过。
- 澄清 `/api/profile` 返回结构：定为 `{ schema_version, candidate }`（与 `schema.json`
  顶层一致），并把区别写进 `docs/api.md`；`/api/analyze` 仍返回
  `{ profile_id, status, schema_version, candidate }` 信封。
- 审查前端契约实现（`feature/frontend-init`）：`frontend/lib/types.ts` 的六模块、
  枚举与证据字段均与 `docs/schema.json` 对齐；唯一待修项是 `getProfile()` 返回类型
  应为 `CandidateProfile`（含 `schema_version`），已随上述 `/api/profile` 决定一并明确。
- D2 文档解析：新增 `app/parser.py`（PDF 用 pypdf 逐页提取文本 + 真实页码；DOCX 用
  python-docx 提取段落 + 表格，页码为 `null`），并补 `tests/test_parser.py`
  （合成 PDF/DOCX 夹具验证文本与页码），8 项测试全部通过。
- 定稿后端接口契约 [docs/api.md](docs/api.md)：
  - `POST /api/upload`：一次上传最多 4 份 PDF / DOCX，返回 `upload_id` 与文档列表。
  - `POST /api/analyze`：触发结构化抽取、外部核验与综合评价，返回符合 `schema.json` 的档案。
  - `GET /api/profile`：按 `profile_id` 或 `upload_id` 返回缓存档案。
  - `POST /api/qa`：加分项，基于档案回答自然语言问题并返回支撑证据。
  - 统一了日期格式、`source_url` 溯源字段、错误码（404 / 413 / 422 / 500）与结果缓存约定。
- 校验 `api.md` 内候选人示例，确认其必填字段、枚举与证据字段均符合 `schema.json`。
- 提交并推送 `feature/backend-init`，将 PR #3 标题更新为
  [Define candidate contract: schema and API](https://github.com/vr200707/AIE1903/pull/3)。
- D4 证据引擎：新增 `app/verify.py`（公开来源联网核验论文声明）与 `tests/test_verify.py`
  （21 项测试全绿）。以 Crossref（期刊/会议，含 DOI）为主力、OpenAlex（覆盖 arXiv
  预印本并带作者名）为补充，判定口径为「先锁定论文身份、再比对年份」：
  - 标题匹配 + 年份一致（容差 1 年）→ `confirmed`，回填 DOI/载体/作者；
  - 标题基本一致但年份矛盾 → `conflict`（保留原文与作者供人工复核）；
  - 仅部分标题相似（相似度不足）→ `to_verify`（不硬判 confirmed，避免误伤）；
  - 检索不到 → `not_found_public`；所有来源网络/服务异常 → `to_verify`。
  - 联网实测：真实论文 `Deep Residual Learning for Image Recognition`(2016) →
    `confirmed`（DOI `10.1109/cvpr.2016.90`）；`Attention is all you need`(2017) →
    `conflict`（OpenAlex 记录 2025 年、作者正确，属 OpenAlex 数据质量问题，可人工复核）。
  - 对拟造样本 `cv_01` 全量跑通：9 篇论文 7 篇 `not_found_public`、2 篇 `to_verify`
    （均为「标题部分重叠的无关论文」），无 `confirmed` 假阳性；结果通过 schema 校验，
    存为 `outputs/sample_verified_cv01.json`（即 D4 交付给肖一飞的完整样本档案）。
- 接入 OCR（光学字符识别，Optical Character Recognition）：新增 `app/ocr.py` 与
  `tests/test_ocr.py`（3 项测试），并在 `app/parser.py` 的 `parse_pdf` 中做自动回退——
  某页 pypdf 提取不到文字（扫描件/纯图片 PDF）时，先经 Poppler 渲染成图片、再用
  Tesseract 识别（默认 `chi_sim+eng`，支持中文与英文）。本机已安装
  `tesseract` / `tesseract-lang`（Popper 已有），并写入 `requirements.txt`
  （pytesseract / pdf2image / Pillow / packaging）。端到端实测：用 Pillow 生成无文字层
  的图片 PDF，`parse_pdf` 正确 OCR 出 `John Doe / PhD in Computer Science`。全仓
  24 项测试全绿；提交并推送 `feature/backend-init`（commit `4105a3b`）。
- D5 联调骨架 + 通用网页搜索：新增 `app/api.py`（`POST /api/upload`、
  `POST /api/analyze`、`GET /api/profile`、`GET /health`）与 `app/main.py` 入口，
  串起「上传 -> 解析（含 OCR）-> 抽取 -> 核验 -> 出档案」完整链路。新增
  `app/search.py` 免费网页搜索后端（默认 Bing HTML `cn.bing.com`，无需 key），并把
  非论文声明（奖项/经费/职位/机构/基本信息）核验接入 `app/verify.py`：
  `verify_profile(verify_web=True)` 用网页搜索补充公开线索，保守产出 `to_verify` /
  `not_found_public` 供人工复核，不把未证实的声明误判为 `confirmed`。补齐
  `python-multipart` 依赖；全仓 37 项测试全绿。
- 端到端实测：对拟造样本 cv_01 跑 `verify_profile(verify_web=True)`，9 篇论文走
  Crossref/OpenAlex、12 条非论文声明走 Bing 搜索，约 47 秒完成，结果存
  `outputs/sample_verified_cv01_web.json`。免费 Bing 对编造的英文短词可能返回弱相关
  线索（如「early」百科），但均标 `to_verify` 不误判，符合保守口径。
- 澄清用户新给的 key：实测为 DeepSeek 大模型 key（非网页搜索 key），已读验证
  `/models` 与 `chat/completions` 均 200；网页搜索暂用免费后端，真实搜索 key 待定。
- 排查并解决 PR #3 的合并冲突（「融合出问题了?」）：GitHub 报
  「This branch has conflicts that must be resolved」，冲突文件只有 `.gitignore`。
  原因是双方在同一位置（文件末尾）相邻新增忽略规则——我方补 `.cache/`，队友
  （前端分支）补 `.npm-cache/`、`.appdata/`，Git 无法自动判定。处理方式：本地合并
  `origin/main`（`806ed98`，含 PR #4/#5/#6），按并集口径保留全部忽略规则，合并提交
  `ff668b7` 已推送。合并后**无任何 `main` 文件丢失**，37 项测试全绿，PR #3 恢复
  `MERGEABLE`；页面仍显示 `BLOCKED` 是因为分支保护要求 1 人 approve，与冲突无关。
- 复核队友已合入 `main` 的前端（Next.js 16 / React 19 / Tailwind 4）：PR #4（D1：TS
  类型 + mock 数据 + API 封装 + 方法说明页）、PR #5（D2：六大模块 UI）、PR #6（D4：
  证据弹窗 + 人工修正入口 + 修复「连续修正不生效」与 `replaceEvidence` 的 TS 构建错误）。
  `frontend/lib/types.ts` 与 `docs/schema.json` 对齐（已含 `CandidateProfile`）；
  `frontend/lib/api.ts` 的 4 个调用（upload / analyze / profile / qa）与后端契约一致。
  D5 联调待修的两点：`getProfile()` 返回类型仍写作 `Candidate`（应为 `CandidateProfile`，
  即 `{ schema_version, candidate }`），以及前端已调用 `/api/qa`、后端尚未实现。
- 补齐 `POST /api/qa`（D5 加分项，见 [docs/api.md](docs/api.md) 第 4 节）：新增
  [app/qa.py](app/qa.py) 并接入 `app/api.py`。设计要点：
  - **引用防伪**：先把档案里所有证据统一编号（E1、E2…）连同档案 JSON 一起交给模型，
    模型只能回传 `evidence_ids`；最终 `evidence` 由后端按编号从档案**原样取回**，
    模型无法编造来源。不存在的编号直接丢弃。
  - **可信度降级**：一条有效证据都拿不出时，`confidence` 一律降为 `low`；非法取值回退 `low`。
  - **只依据档案作答**：查不到的问题返回「档案中没有相关信息」+ `low` + 空证据；
    档案内部矛盾时要求指出矛盾并列出双方证据编号。
  - 错误码：`422 missing_profile_id / missing_question`、`404 not_found / not_analyzed`、
    `500 qa_failed`。
- `/api/qa` 实测（真实 DeepSeek 调用，4 个问题）：事实直答 → `high` + 3 条证据；
  需要汇总的问题（论文篇数/总引用量）→ `medium` + 8 条证据，并主动说明
  `total_citations` 为 `null`、不臆造汇总值；档案中不存在的「图灵奖」→ `low` + 空证据；
  英文提问正常作答。结果存 `outputs/sample_qa_cv01.json`。全仓 52 项测试全绿。
- 测试：新增 [tests/test_qa.py](tests/test_qa.py)（编号完整性、证据回填、幻觉编号丢弃、
  去重、非法 confidence 回退、空问题/空回答/坏 JSON 报错、证据条数上限），并在
  `tests/test_api.py` 补 `/api/qa` 的 200/404/422/500 四项。
- 处理肖一飞 review 反馈的三项（P0-1 / P1-2 / P1-3）：
  - P0-1 后端合并：核实 PR #3 已合并进 `main`（`9dc386d`），该条已闭环；另合并已 approve
    且 clean 的前端 PR #7（`getProfile` 返回类型改为 `CandidateProfile` + 前端接入真实
    upload/analyze 联调接线）。
  - P1-2 OCR 测试跨平台：`tests/test_ocr.py` 的字体路径改为按平台探测候选（macOS /
    Windows / Linux）并检查 tesseract，缺任一项时跳过图像类测试、纯逻辑测试照常跑。
  - P1-3 错误契约：后端 `app/api.py` 实际返回嵌套 `{"detail":{"code","detail"}}`，而
    `docs/api.md` 原写平铺 `{"detail":"...","code":"..."}`。决策为「改文档对齐后端」——
    后端已按嵌套落地、前端也已按对象形态兼容，改文档是零风险最小改动；并在文档注明
    FastAPI 自身校验错误时 `detail` 为数组，前端需兼容数组 / 对象两种形态。
  - 上述两处代码/文档修复开新 PR #10（`codex/fix-ocr-font-and-error-docs`），全仓 52 项
    测试通过。

### 待办（下一步）

- 群里 @ 肖一飞、赵越：告知 `/api/profile` 返回结构已定为 `{ schema_version, candidate }`，
  请肖一飞把 `getProfile()` 返回类型改为 `CandidateProfile`。
- 给赵越交付抽取结果样例（`outputs/` 三份）+ 边界用例清单（扫描件无文字层、跨文档
  冲突需 OCR 才能判定、中文/双语/德文风格兼容）。
- 奖项/经费/职位/机构等非论文声明仍需通用网页搜索（Tavily / Brave / SerpAPI 等，需单独
  key），当前未接；论文核验已与这部分解耦，拿到 key 后按同一 evidence 契约扩展。
- 扫描件 `cv_09` 无文字层的 OCR 已接入（见上方「已完成」）；但样本 PDF 当前不在本机
  磁盘上（`/Users/steven/Downloads/AIE1903_CV_test_samples_2026-09-29/` 缺失），
  待用户重新提供样本后，即可实测 `cv_09` 的中文识别，并验证 `cv_08` / `cv_09`
  跨文档冲突（博士毕业年份、当前职位）。
- 尚未 commit：`app/`、`tests/`、`outputs/`、`docs/api.md` 等有大量未提交改动，待确认后
  commit 并 push 到 `feature/backend-init`。
- D5 联调：启动 FastAPI，与肖一飞端到端打通。
- `POST /api/qa`（加分项）尚未实现，待下一轮补齐。
- 免费 Bing 搜索是过渡方案：拿到 Tavily / Brave / Serper 等付费 key 后，在
  `app/search.py` 新增 provider 并切换 `WEB_SEARCH_PROVIDER`，提升非论文声明线索质量。
- 与肖一飞端到端联调：`uvicorn app.main:app --reload`，用 `/api/upload` +
  `/api/analyze` + `/api/profile` 验证前后端数据契约。
- 联调待修 1：`frontend/lib/api.ts` 的 `getProfile()` 返回类型改为 `CandidateProfile`
  （`Promise<CandidateProfile>`）并补 import——后端 `GET /api/profile` 已定为
  `{ schema_version, candidate }`。
- ~~联调待修 2：`POST /api/qa` 后端尚未实现~~ → 已完成（见上方 `app/qa.py`）。
- 说明：上方两条（「尚未 commit」「样本 PDF 缺失」）已不再适用——改动均已提交推送，
  样本夹具已就位于 `/Users/steven/Downloads/AIE1903_CV_test_samples_2026-09-29/`。

## 2026-09-28

### 已完成

- D0 基础环境：仓库、`main` 分支保护、`.gitignore`、`feature/backend-init` 分支、
  虚拟环境与依赖（FastAPI、pydantic、pypdf、python-docx、openai、python-dotenv）。
- 定稿数据契约 [docs/schema.json](docs/schema.json)：
  - 6 大模块：基本信息、教育与工作、奖项与经费、论文与影响、学术服务、综合评价。
  - 统一证据字段：`source`、`source_url`、`evidence`、`evidence_status`、`query_date`。
  - `evidence_status` 枚举：`confirmed` / `not_found_public` / `to_verify` / `conflict`。
  - 作者角色、经费角色（PI / Co-PI / participant / unknown）、学术服务类型等枚举。
  - 新增 `source_url` 一键溯源字段：有链接存链接，无链接存 `null` 占位，方便日后补充。
  - `additionalProperties: false` 严格校验；未知信息用 `null` 或空数组，禁止推测补全。
  - 日期支持 `YYYY` / `YYYY-MM` / `YYYY-MM-DD`，校验大小月与闰年。
  - 链接约束为带有效主机的 HTTP(S) 地址。
- 编写契约测试 [tests/test_schema_contract.py](tests/test_schema_contract.py)（5 项，全部通过）。
- 提交并推送 `feature/backend-init`，创建 PR #3。

### 待办

- 见上方 2026-09-29 待办（逐项推进）。
