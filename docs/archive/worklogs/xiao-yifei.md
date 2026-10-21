# Project 1 工作日志（肖一飞 · 前端 & 交互）

> 记录方式：按日期追加续写，最新在上；每次只新增日期条目，不改写历史条目。

## 2026-09-29

### 已完成

**D0 — 脚手架**
- [x] clone 仓库 `vr200707/AIE1903`，创建并切换 `feature/frontend-init` 分支。
- [x] 用 `create-next-app` 初始化 Next.js + TypeScript + Tailwind（Next 16.3.6 / React 19 / Tailwind v4）。
- [x] 依赖安装（364 包，用 npmmirror 镜像加速）；dev 服务器冒烟测试 HTTP 200。

**D1 — 骨架**
- [x] 拉取沈一的 `docs/schema.json` + `docs/api.md`，据此写完整 TS 类型 `lib/types.ts`。
- [x] 写脱敏 mock 候选人档案 `lib/mock.ts`（覆盖 6 大模块）。
- [x] 写 API 客户端 `lib/api.ts`（upload / analyze / profile / qa 四接口）。
- [x] 主页骨架 `app/page.tsx` + 方法说明页占位 `app/methodology/page.tsx`。

**审查修复（PR #4 review 后）**
- [x] 解决根目录 `.gitignore` 合并冲突（保留 main 的 Python 规则 + 前端 `.npm-cache/`、`.appdata/`）。
- [x] `getProfile()` 增加"只能传 profile_id 或 upload_id 之一"的参数校验。
- [x] 错误处理兼容 FastAPI 422 的 `detail` 数组。

**D2 — 档案视图**
- [x] 新增 `lib/labels.ts`（枚举→中文文案）、`components/EvidenceBadge`、`EvidenceList`、`Section`。
- [x] 重写 `app/page.tsx`，渲染档案 6 大模块（基本信息/教育与工作/奖项与经费/论文与影响/学术服务/综合评价），每条记录带证据与状态徽章。

**D3 — 证据弹窗 + 标签筛选**
- [x] 新增 `components/EvidenceModal`（点证据弹窗看完整详情 + 查看原文链接）。
- [x] 新增 `components/TagFilter`（关键词搜索 + 标签筛选）。
- [x] `EvidenceList` 改为可点击；`page.tsx` 用 `useState` 管理筛选与弹窗状态。

**D4 — 人工修正入口 + 方法说明页**
- [x] `EvidenceModal` 增加"人工修正证据状态"下拉框。
- [x] `page.tsx` 引入 candidate 状态 + `correctEvidence`（深拷贝替换，不改动 mock 原对象）。
- [x] 方法说明页填充 4 大板块：证据字段定义 / 证据状态判定规则 / 缺失冲突处理 / 档案模块。

**Git 协作**
- [x] 提交并推送 D1–D4（commits：`a71cc23`、`92849d4`、`3a006c7`、`5c5031f`）。
- [x] 创建 PR #4（D1）、PR #5（D2+D3）、PR #6（D4）。
- [x] PR #4、#5 已合并进 main；PR #6 待队友 review。

### 待办（下一步）

- [ ] D5 联调：把前端 mock 数据换成沈一后端真实 API（`localhost:8000`）。
- [ ] D6–D7 配合答辩（7 步 Demo 走通）。

### 当前阻塞

D5 联调依赖沈一后端 D2–D4 完成、FastAPI 启动，以及 `/api/profile` 返回结构（裸 Candidate vs 外层对象）的明确确认。
