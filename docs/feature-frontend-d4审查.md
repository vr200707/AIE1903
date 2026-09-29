# feature/frontend-init D4 审查

> 审查人：赵越
> 审查日期：2026-09-29
> 开放 PR：#6
> 被审查提交：`5c5031f810bb1f277684d311ab1494fd61b237a7`
> 对照合同：`docs/schema.json` 1.0.0、`docs/api.md`

## 审查结论

PR #6 当前不能批准或合并。敏感文件、合并冲突和 lint 检查通过，但生产构建失败；
连续两次人工修正同一条证据时，第二次修改不会同步到档案列表。

## 阻塞问题

### B1：生产构建 TypeScript 失败

`npm run build` 在 `frontend/app/page.tsx` 报错：

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

影响：`next build` 和依赖构建产物的正式部署均失败。

### B2：连续人工修正不会再次更新档案

实际浏览器操作：

1. 打开 `candidate_cv.pdf` 的证据详情。
2. 把状态从“已确认”改为“待核实”：列表同步更新。
3. 在同一个弹窗中继续改为“冲突”：弹窗下拉框显示“冲突”，但档案列表仍为
   “待核实”。

根因：第一次修正后，`setCandidate()` 创建了新的对象树；随后
`setSelectedEvidence()` 又创建了脱离候选档案的新对象。第二次调用
`replaceEvidence()` 时，`value === target` 无法再匹配档案树中的证据对象。

## 已通过检查

- 未发现 `.env`、真实候选人 PDF/DOCX、私钥、API token 或 `data/private/` 内容。
- 与当前 `main` 的合并预检成功，没有冲突。
- `npm ci`：364 个包，0 个已知漏洞。
- `npm run lint`：通过。
- 方法说明页已包含证据字段、状态规则、缺失与冲突处理、档案模块。
- 第一次人工修正可以更新弹窗和档案列表。

## 非阻塞观察

- 方法说明页提到“置信度”，但当前 `overall_evaluation` schema 没有置信度字段。
  建议改成“各维度评价”，或待合同扩展后再展示置信度。
- 人工修正目前只保存在浏览器内存中，刷新后恢复 mock 数据。若演示口径是
  “可交互修正”而非“持久化保存”，需要在方法说明中标明。
- `/api/profile` 返回包装层和多标签筛选语义仍需在 D5 前确认。

## 建议

1. 肖一飞修复 `replaceEvidence()` 的 TypeScript 类型错误，并重新运行
   `npm run build`。
2. 人工修正改为基于稳定路径、索引或当前档案树查找目标证据，不要依赖旧的
   对象引用。
3. 修复后重新验证“同一条证据连续修改两次”。
4. 修复完成前不要把 PR #6 合并到 `main`。
