# 运行与故障排查

## 启动顺序

1. 启动后端：`uvicorn app.main:app --reload --port 8000`
2. 检查 `http://localhost:8000/health/live`
3. 检查 `http://localhost:8000/health/ready`
4. 启动前端：`cd frontend && npm run dev`
5. 检查 `http://localhost:3000`

## 健康检查

| 端点 | 用途 | 是否依赖外部网络 |
|---|---|---|
| `/health` | 兼容旧脚本，等同于存活检查 | 否 |
| `/health/live` | 判断 FastAPI 进程是否存活 | 否 |
| `/health/ready` | 检查 Schema、上传目录和 DeepSeek 配置 | 否 |
| `/health/dependencies` | 查看各外部依赖的配置和最近调用状态 | 否 |

`/health/ready` 在关键配置缺失或存储不可写时返回 `503`。它不会为了健康检查调用
DeepSeek、Crossref、OpenAlex 或 Bing，避免产生费用和额外限流。

`/health/dependencies` 中的远程依赖初始状态为 `unknown`，只有实际分析调用后才更新
为 `ok` 或 `error`。OCR 和 PDF 渲染会额外显示本机可执行文件是否已安装。

## 部分失败行为

- 单份文档损坏时，其他文档仍会继续抽取。
- OCR 不可用时，已提取的文字层会保留，并在响应中返回可重试警告，不把缺失页面
  当作已分析内容。
- Crossref、OpenAlex 或 Bing 失败时，不会把故障解释为候选人声明为假。
- 外部核验整体异常时，已抽取档案仍会返回，API 状态为
  `completed_with_warnings`。
- 所有文档都没有可提取文本时，API 返回 `422 no_readable_documents`。

## 常见问题

### 前端请求失败

- 确认后端运行在 `http://localhost:8000`。
- 检查 `frontend/next.config.ts` 中的 `/api/*` 代理。
- 跨机器联调时设置 `NEXT_PUBLIC_API_BASE`。

### 扫描 PDF 无法识别

- 安装 Tesseract。
- 安装 `chi_sim` 和 `eng` 语言包。
- 安装 Poppler 并确保 `pdftoppm` 可执行。
- 必要时设置 `TESSERACT_CMD`。

### 分析耗时过长

- `/api/analyze` 当前是同步接口。
- 可通过 `VERIFY_MAX_WORKERS` 调整核验并发数。
- 当前没有任务队列、进度回传或取消机制。

### 网页核验不稳定

- 当前免费搜索后端依赖公开 Bing HTML 页面。
- 页面结构变化或速率限制会触发 `to_verify`。
- 系统不会把搜索故障误判为声明为假。

## 本地数据

- `.cache/uploads/`：上传文件
- `.cache/extraction/`：抽取缓存
- `data/private/`：真实材料，不提交
- `data/samples/`：受控样本，默认不提交
