# 数据契约

`schema.json` 是 AIE1903 候选人档案的唯一权威数据结构。

## 当前版本

- `schema_version`: `1.0.0`
- JSON Schema Draft: `2020-12`
- 顶层字段：`schema_version`、`candidate`
- 候选人模块：`basic_info`、`education_employment`、`awards_funding`、
  `publications_impact`、`academic_service`、`overall_evaluation`

## 修改规则

1. 先修改 `schema.json`，再更新代码、类型、测试和文档。
2. 运行 `python -m scripts.schema_validation`。
3. 运行全部后端测试。
4. 新增或更新 `examples/profiles/` 中的脱敏样例。
5. 破坏兼容性的修改必须提升 `schema_version`。

前端 TypeScript 类型位于 `frontend/lib/types.ts`，当前为手工同步。任何 schema
枚举、必填字段或嵌套结构变化都必须同时检查该文件。

## 面试工作流契约

`interview.schema.json` 定义英文视频面试的问题集和最终报告。其根节点使用
`oneOf`，可通过 `$defs.QuestionSet` 与 `$defs.InterviewReport` 分别生成前端类型。
报告中的 `timestamp_inventory` 是前端视频定位与问题溯源的主入口。
