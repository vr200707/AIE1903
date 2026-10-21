# feature/frontend-init D4 审查

> 审查人：赵越
> 审查日期：2026-09-29
> 开放 PR：#6
> 初查提交：`5c5031f810bb1f277684d311ab1494fd61b237a7`
> 复查提交：`5bba1a66ccea02a2d106f0771ad726e1f1fa29fe`
> 对照合同：`docs/schema.json` 1.0.0、`docs/api.md`

## 审查结论

初查发现的 TypeScript 构建错误和连续修正失效均已修复。复查提交 `5bba1a6`
通过生产构建、lint 和浏览器连续修正验证。PR #6 技术检查已完成，可以进入人工
approve / merge 流程。

## 初查问题与修复结果

### B1：生产构建 TypeScript 失败（已修复）

初查时 `npm run build` 在 `frontend/app/page.tsx` 报错：

- 第 46 行：泛型类型与 `Evidence` 没有重叠。
- 第 47 行：无法从非对象类型创建 spread。

根因位于 `replaceEvidence()` 的泛型对象收窄：

```ts
if (value && typeof value === "object") {
  if (value === target) {
    return { ...value, evidence_status: status } as unknown as T;
  }
}
```

修复提交 `5bba1a6` 移除了对象引用递归替换方案，改为用 `Map<Evidence,
EvidenceStatus>` 保存修正状态。复查 `npm run build` 已通过。

### B2：连续人工修正不会再次更新档案（已修复）

初查时实际浏览器操作：

1. 打开 `candidate_cv.pdf` 的证据详情。
2. 把状态从“已确认”改为“待核实”：列表同步更新。
3. 在同一个弹窗中继续改为“冲突”：弹窗下拉框显示“冲突”，但档案列表仍为
   “待核实”。

根因：第一次修正后，`setCandidate()` 创建了新的对象树；随后
`setSelectedEvidence()` 又创建了脱离候选档案的新对象。第二次调用
`replaceEvidence()` 时，`value === target` 无法再匹配档案树中的证据对象。

修复提交改用原始证据对象作为 Map 键，不复制候选档案树。复查操作：

1. 把状态从“已确认”改为“待核实”：列表和弹窗均显示“待核实”。
2. 在同一个弹窗继续改为“冲突”：列表和弹窗均同步显示“冲突”。

## 已通过检查

- 未发现 `.env`、真实候选人 PDF/DOCX、私钥、API token 或 `data/private/` 内容。
- 与当前 `main` 的合并预检成功，没有冲突。
- `npm ci`：364 个包，0 个已知漏洞。
- `npm run build`：Next.js 生产构建和 TypeScript 检查通过。
- `npm run lint`：通过。
- 方法说明页已包含证据字段、状态规则、缺失与冲突处理、档案模块。
- 同一证据连续两次人工修正均可以更新弹窗和档案列表。

## 非阻塞观察

- 方法说明页已移除 schema 中不存在的“置信度”描述。
- 人工修正目前只保存在浏览器内存中，刷新后恢复 mock 数据。若演示口径是
  “可交互修正”而非“持久化保存”，需要在方法说明中标明；页面已经补充此说明。
- `/api/profile` 返回包装层和多标签筛选语义仍需在 D5 前确认。

## 结论

PR #6 的 D4 技术审查已完成，不再有阻塞问题。是否 approve / merge 交给人工按
团队流程决定。
