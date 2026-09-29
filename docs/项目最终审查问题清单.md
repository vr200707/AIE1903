# Project 1 最终审查问题清单

> 审查日期：2026-09-29
> 审查范围：`main`、`feature/backend-init`、`feature/frontend-init`
> 审查目标：判断项目是否已经达到可合并、可联调、可演示状态

## 结论

项目主体功能已经成形，但目前不能视为已经完成集成。后端、前端最后一处类型修正和
README 仍分布在未合并分支中；D5 浏览器联调还缺少 CORS、真实 API 接线和部分接口
一致性处理。

## 分支快照

| 分支 | 当前提交 | 状态 |
|---|---|---|
| `main` | `806ed98` | 只包含前端和 Python 依赖，不含后端实现 |
| `feature/backend-init` | `237f373` | 后端解析、抽取、核验和 API 已完成，PR #7 待合并 |
| `feature/frontend-init` | `5cfd22d` | 最终 `getProfile` 类型修正，尚未合并 |
| `docs/readme-en` | `c4443bf` | 英文 README 已完成并推送，尚未建 PR |

## P0：进入 D5 联调前必须处理

### P0-1：后端尚未合并到 `main`

- 现状：`main` 中没有 `app/`、后端测试、样例输出和 `.env.example`。
- 影响：从 `main` 克隆后无法启动完整系统。
- 负责人：沈一。
- 完成标准：PR #7 合并到 `main`，且合并后 `uvicorn app.main:app` 可以启动。

### P0-2：PR #7 与 `main` 存在 `.gitignore` 合并冲突

- 冲突位置：根目录 `.gitignore`。
- 后端新增：`.cache/`。
- 主分支已包含前端规则：`.npm-cache/`、`.appdata/`。
- 影响：PR #7 当前不能直接合并。
- 负责人：沈一。
- 完成标准：保留双方需要的忽略规则，重新执行合并预检并确认无冲突。

### P0-3：前端最终类型修正尚未合并

- 提交：`5cfd22d`。
- 修改：`getProfile()` 的返回类型从 `Candidate` 改为带 `schema_version` 的
  `CandidateProfile`。
- 影响：当前 `main` 的前端类型与后端 `/api/profile` 实际返回结构不一致。
- 负责人：肖一飞。
- 完成标准：创建并合并对应 PR，或将该提交纳入下一次前端合并。

### P0-4：FastAPI 没有 CORS 或前端代理

- 现状：FastAPI 中间件为空，Next.js 也没有代理配置。
- 影响：前端 `localhost:3000` 通过浏览器调用 `localhost:8000` 时会被 CORS 阻止。
- 负责人：沈一或肖一飞，二者选一。
- 完成标准：
  - FastAPI 允许 `http://localhost:3000`，或
  - Next.js 将 `/api/*` 代理到后端。

### P0-5：前端仍直接使用 mock，真实 API 尚未接线

- 现状：`frontend/app/page.tsx` 直接读取 `frontend/lib/mock.ts`。
- 影响：上传、分析、档案读取和错误处理没有形成真实浏览器链路。
- 负责人：肖一飞。
- 完成标准：通过 `frontend/lib/api.ts` 调用后端，并跑通
  `upload -> analyze -> profile`。

## P1：合并或演示前应处理

### P1-1：`/api/qa` 只有文档，没有后端实现

- 文档位置：`docs/api.md`。
- 前端状态：`frontend/lib/api.ts` 有 `askQuestion()`。
- 后端状态：FastAPI 路由中没有 `/api/qa`。
- 判断：问答是文档中的加分项，不阻塞必做演示，但不能宣称已经完成。
- 完成标准：实现接口，或从文档和前端中明确标记为未实现的可选扩展。

### P1-2：OCR 测试存在跨平台问题

- 测试结果：后端 37 项中 35 项通过，2 项失败。
- 失败位置：`tests/test_ocr.py` 硬编码 macOS 字体路径
  `/System/Library/Fonts/Supplemental/Arial.ttf`。
- 环境状态：当前机器未检测到 Tesseract 可执行文件。
- 影响：当前 Windows/Linux 环境无法完整执行 OCR 测试。
- 完成标准：
  - 根据操作系统选择可用字体，或把字体测试资源放入测试目录；
  - 文档中明确 Tesseract、语言包和 Poppler 的安装要求；
  - OCR 环境可用后重新运行全部测试。

### P1-3：错误响应契约不一致

- 文档约定：`{"detail": "可读错误", "code": "validation_error"}`。
- 后端实际：`HTTPException(detail={"code": ..., "detail": ...})`，FastAPI 会生成
  `{"detail": {"code": ..., "detail": ...}}`。
- 前端行为：按字符串读取 `detail`，收到对象时可能显示 `[object Object]`。
- 影响：D5 错误提示不一致。
- 完成标准：后端改成统一错误结构，或前端和后端共同采用新的错误契约。

## P2：文档与仓库整理

### P2-1：英文 README 尚未合并

- 分支：`docs/readme-en`。
- 提交：`c4443bf`。
- 内容：功能、架构、安装、API、数据契约、测试、隐私和当前限制。
- 待办：创建 PR，并在后端和前端修正合并后更新“Project Status”部分。

### P2-2：后端分支包含工具生成的 `AGENTS.md`

- 文件：根目录 `AGENTS.md`。
- 内容：主要规定 `沈一WORKLOG.md` 的 AI 协作规则。
- 判断：不影响运行，但属于仓库元文件，应由沈一确认是否保留。

## 已通过验证

- 后端 35 项测试通过。
- 前端最终提交 `5cfd22d` 的 `npm run build` 和 `npm run lint` 通过。
- 5 份后端样例 JSON 全部通过 `docs/schema.json`。
- 后端分支未发现 `.env`、真实候选人材料、私钥或 API token。
- `main` 与前端最终分支可以正常合并，没有代码冲突。

## 建议处理顺序

1. 沈一解决 PR #7 的 `.gitignore` 冲突并合并后端。
2. 肖一飞合并 `5cfd22d`，完成 CORS/代理和真实 API 接线。
3. 沈一确认并处理 `/api/qa` 和统一错误响应。
4. 修复 OCR 测试的跨平台字体问题，并准备 Tesseract 环境。
5. 合并 `docs/readme-en`，更新最终项目状态和运行说明。
6. 在上述事项完成后，重新执行后端测试、前端构建和完整 D5 联调。
