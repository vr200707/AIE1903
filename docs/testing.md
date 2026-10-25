# Schema 测试用例设计

> 对应合同：`contracts/schema.json` 1.0.0
> 设计日期：2026-09-29
> 当前状态：合成用例已实现；真实样本用例等待团队材料与抽取结果。

## 判定口径

- **硬错误**：`schema.json` 明确禁止的结构、类型、枚举、格式、必填字段或额外字段。
- **警告**：schema 允许，但不符合团队约定的数据质量规则，不直接判失败。
- **真实样本**：必须来自团队提供的脱敏材料，不把合成数据描述成真实候选人事实。

## 硬错误用例

| 编号 | 场景 | 输入变化 | 预期 |
|---|---|---|---|
| E-001 | 缺少根字段 | 删除 `schema_version` | 硬错误 |
| E-002 | 缺少候选模块 | 删除 `overall_evaluation` | 硬错误 |
| E-003 | 缺少嵌套必填字段 | 教育记录删除 `advisor` | 硬错误 |
| E-004 | 额外字段 | 根对象或 evidence 增加未声明字段 | 硬错误 |
| E-005 | 证据字段缺失 | 删除 `source/source_url/evidence/evidence_status/query_date` 中任一项 | 硬错误 |
| E-006 | 证据列表为空 | 将任一 `evidence` 数组设为 `[]` | 硬错误 |
| E-007 | 证据状态非法 | `evidence_status = "maybe"` | 硬错误 |
| E-008 | 业务枚举非法 | 非法 `venue_type/service_type/author_role/role` | 硬错误 |
| E-009 | 日期非法 | 非 ISO 部分日期或不存在的日期，如 `2023-02-29` | 硬错误 |
| E-010 | 来源链接非法 | 使用非 HTTP/HTTPS 链接 | 硬错误 |
| E-011 | 数值越界 | 引用量、Stars、金额或年份小于约束 | 硬错误 |
| E-012 | 类型错误 | 期望数组、对象、字符串或整数处使用错误类型 | 硬错误 |

## 合法与警告用例

| 编号 | 场景 | 输入变化 | 预期 |
|---|---|---|---|
| V-001 | 最小合法档案 | 未知信息用 `null` 或空数组 | 通过 |
| V-002 | 六模块完整合成档案 | 每个模块至少一条记录 | 通过 |
| V-003 | 无公开链接 | `source_url = null` | 通过 |
| W-001 | 查无公开证据 | `not_found_public` 使用非空 `source_url` | 警告，不失败 |
| W-002 | 冲突证据不足 | 单条 `conflict` 证据 | 警告，不失败 |
| W-003 | 冲突证据充分 | 两条及以上 evidence，其中含 `conflict` | 通过，无该警告 |

## 执行映射

- 合成立即测试位于 `tests/test_schema_validation.py`。
- 面试问题、时间戳引用、上下文 map-reduce 和 API 链路位于
  `tests/test_interview_workflow.py`。
- PyAV 媒体探测与客观语流指标位于 `tests/test_interview_media.py`。
- schema 元校验入口为 `python -m scripts.schema_validation --schema contracts/schema.json`。
- 收到真实样本后新增 `S-*` 用例，记录样本哈希、脱敏状态、来源文件和预期结果。
- 真实候选人材料不得提交入库；只在本地私有目录执行。

## 样本材料清单

- CV（PDF 或 DOCX）
- Cover Letter
- Research Statement
- Teaching Statement
- 可选公开来源：个人主页、Google Scholar、GitHub

## 合成样本

合成样本生成器位于 `scripts/fixtures/generate_cv_fixtures.py`。生成文件默认写入
`data/samples/cv-fixtures-2026-09-29/`，该目录中的二进制样本不提交到 Git。

生成前可按环境设置：

```text
CV_FIXTURE_FONT_DIR=/path/to/fonts
POPPLER_DIR=/path/to/poppler/bin
```

检查已有样本：

```bash
python -m scripts.check_sample_documents
```
