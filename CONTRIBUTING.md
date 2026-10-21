# 协作规范

## 分支与合并

- `main` 始终保持可安装、可启动、可测试。
- 每个任务从最新 `main` 创建独立分支。
- 分支命名使用 `feature/`、`fix/`、`docs/` 或 `chore/` 前缀。
- 合并前通过 Pull Request，并由至少一名队友审查。
- 不在 `main` 上直接提交实验代码。

## 提交前检查

```bash
python -m unittest discover -v
python -m scripts.schema_validation
cd frontend
npm run lint
npm run build
```

OCR 不可用时，允许跳过明确标记的 OCR 测试，但必须在 PR 中说明。

## 不应提交的内容

- `.env`、`frontend/.env.local`、API Key 和私钥
- 真实候选人材料
- `.venv/`、`node_modules/`、`.next/`、`.cache/`
- `data/samples/` 中未经批准的二进制样本
- 日志、临时文件和个人本地配置

## 契约变更

- `contracts/schema.json` 是数据结构的唯一来源。
- 修改契约时必须同步：
  - `app/extractor.py`
  - `frontend/lib/types.ts`
  - schema 契约测试
  - API 文档和示例
- 破坏兼容性的修改需要提升 `schema_version`。

## 文档

- README 只保留入口级说明。
- API 细节写入 `docs/api.md`。
- 证据判定写入 `docs/methodology.md`。
- 阶段任务单、个人日志和审查快照放入 `docs/archive/`。
