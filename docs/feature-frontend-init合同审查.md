# feature/frontend-init 合同审查

> 审查人：赵越
> 审查日期：2026-09-29
> 初查提交：`a71cc23853378d34cddba42c3f8286b7a0f17e35`
> 复查提交：`97fe290d994e4197b22b42df3551a54438dd6a85`
> 开放 PR：#4
> 对照合同：`docs/schema.json` 1.0.0、`docs/api.md`

## 审查结论摘要

前端 D1 的类型、mock 数据和四个 API 函数总体与合同对齐，mock 数据已经通过
JSON Schema 实际校验。初查发现的 `.gitignore` 合并冲突、`getProfile()` 参数边界
和 422 错误文本处理均已在后续提交修复。当前只剩 `/api/profile` 的精确返回包装层
需要沈一确认，确认后即可进入正式 PR review。

## 检查结果

### 1. 敏感文件

- 结果：通过。
- 分支共变更 22 个文件，没有发现 `.env`、真实候选人 PDF/DOCX、私钥、
  `data/private/` 内容或 API token。
- 搜索未命中 `sk-*`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 或私钥标记。

### 2. 合并冲突

- 结果：已修复。
- commit `4a70a93` 已将 `main` 合入前端分支，并同时保留 `venv/`、
  `__pycache__/`、`*.pyc`、`.npm-cache/` 和 `.appdata/`。
- 重新执行 `git merge-tree --write-tree origin/main origin/feature/frontend-init`
  可以正常生成合并树，没有报告冲突。

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

- 结果：路径和请求体对齐，剩余一个后端确认项。
- `/api/upload` 使用 `files` multipart 字段，与文档一致。
- `/api/analyze` 使用 `upload_id`，与文档一致。
- `getProfile()` 已增加“恰好传一个 ID”的校验，不会再生成
  `upload_id=undefined`。
- 错误处理已兼容 FastAPI 422 的 `detail` 数组，并转换为可读文本。
- `/api/profile` 的返回类型是裸 `Candidate`；文档写的是
  “与 `/api/analyze` 返回的 `candidate` 结构一致”，需要与后端确认后端实际是否
  返回裸对象，还是返回带 `profile_id/status` 的外层对象。

### 6. 构建与运行验证

- 结果：通过。
- `npm ci`：安装 364 个包，0 个已知漏洞。
- `npm run build`：Next.js 16.3.6 生产构建成功，TypeScript 检查和静态页面生成
  均通过；`/`、`/_not-found`、`/methodology` 三个路由成功生成。
- `npm run lint`：ESLint 退出码为 0。
- 使用生产构建启动临时服务器：首页和方法说明页均返回 HTTP 200，并包含预期页面
  内容。

## 后续建议

1. 沈一确认 `/api/profile` 的精确响应结构。
2. 确认后在 PR #4 提交正式 GitHub review。
3. 联调时继续验证上传、分析、档案读取和问答四条真实请求链路。

## 未验证项

- 已确认开放 PR 为 #4，头部提交为 `97fe290`。
- 已完成依赖安装、生产构建、lint 和 HTTP 运行冒烟；页面视觉和交互功能仍留待 D2。
