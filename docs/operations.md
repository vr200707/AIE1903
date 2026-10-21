# 运行与故障排查

## 启动顺序

1. 启动后端：`uvicorn app.main:app --reload --port 8000`
2. 检查 `http://localhost:8000/health`
3. 启动前端：`cd frontend && npm run dev`
4. 检查 `http://localhost:3000`

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
