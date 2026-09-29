# feature/frontend-init 合同审查

> 审查人：赵越
> 审查日期：2026-09-29
> 被审查提交：`a71cc23853378d34cddba42c3f8286b7a0f17e35`
> 对照合同：`docs/schema.json` 1.0.0、`docs/api.md`

## 审查结论摘要

前端 D1 的类型、mock 数据和四个 API 函数总体与合同对齐，mock 数据已经通过
JSON Schema 实际校验。当前不能直接批准合并，主要原因是根目录 `.gitignore`
存在合并冲突，另有三个需要在联调前确认的接口边界问题。

## 检查结果

### 1. 敏感文件

- 结果：通过。
- 分支共变更 22 个文件，没有发现 `.env`、真实候选人 PDF/DOCX、私钥、
  `data/private/` 内容或 API token。
- 搜索未命中 `sk-*`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 或私钥标记。

### 2. 合并冲突

- 结果：发现问题。
- `git merge-tree --write-tree origin/main origin/feature/frontend-init`
  报告根目录 `.gitignore` 内容冲突。
- 前端分支基于旧版 `main`，缺少主分支新增的 Python 忽略规则；自身增加了
  `.npm-cache/` 和 `.appdata/`。
- 解决时应同时保留 `venv/`、`__pycache__/`、后端相关忽略规则，以及前端新增的
  `.npm-cache/`、`.appdata/`。该修改应由前端分支负责人完成。

### 3. TypeScript 类型

- 结果：与 `schema.json` 对齐。
- 6 个候选模块字段名齐全。
- `evidence_status`、`source_type`、`author_role`、`venue_type`、
  `service_type` 和经费 `role` 枚举一致。
- `Evidence` 的 5 个必填字段和 3 个可选字段一致。
- TypeScript 无法表达 `minLength`、URL、日期、枚举等运行时约束；这些约束仍需由
  schema 校验器负责。

### 4. Mock 数据

- 结果：通过 schema 校验。
- 使用 Node 类型剥离功能读取 `frontend/lib/mock.ts` 并输出 JSON，
  再由 `tools/schema_validation.py` 验证。
- 校验结果：`VALID`。
- 产生一条 warning：`basic_info.to_verify[0].evidence` 是单条 `conflict`
  证据。该 warning 符合 team 约定，不升级为硬错误。

### 5. API 客户端

- 结果：路径和请求体基本对齐，存在三个边界风险。
- `/api/upload` 使用 `files` multipart 字段，与文档一致。
- `/api/analyze` 使用 `upload_id`，与文档一致。
- `/api/profile` 的返回类型是裸 `Candidate`；文档写的是
  “与 `/api/analyze` 返回的 `candidate` 结构一致”，需要与后端确认后端实际是否
  返回裸对象，还是返回带 `profile_id/status` 的外层对象。
- `getProfile()` 没有校验“恰好传一个 ID”。两个参数都缺失时会请求
  `upload_id=undefined`；两个都传入时静默优先使用 `profile_id`。
- 错误处理假定 `detail` 一定是字符串；FastAPI 默认 422 可能是数组，需要与后端
  统一错误处理格式。

## 合并前建议

1. 前端负责人先把 `main` 合入或 rebase 到 `feature/frontend-init`，解决
   `.gitignore` 冲突。
2. `getProfile()` 在发请求前检查参数数量，避免生成 `undefined` 查询值。
3. 沈一确认 `/api/profile` 的精确响应结构和 FastAPI 422 错误体。
4. 肖一飞为 `feature/frontend-init` 建立 GitHub PR；当前开放 PR 只有 #3，
   因此暂时不能提交正式 GitHub review 或 approve。

## 未验证项

- 本轮没有安装 Next.js 依赖，也没有执行 `npm run build` 或浏览器端运行测试。
- 本轮目标是合同、隐私和合并预检；页面视觉和交互功能留待 D2。
