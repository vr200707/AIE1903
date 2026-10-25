# Interview 页面前端接入建议

本文档面向前端工程师。后端契约以
[`contracts/interview.schema.json`](../contracts/interview.schema.json) 为准，
HTTP 细节见 [`docs/interview-api.md`](interview-api.md)。

## 1. 路由与入口

建议新增独立页面：

```text
/interview/[profileId]
```

在现有 profile 结果页增加一个明确入口，例如 `Prepare interview`。进入页面时只传
`profileId`，不要在前端重新组装 profile。

页面采用三步流程，不使用审核发布环节：

1. Generate questions
2. Upload video
3. Review report

## 2. Generate Questions

需要展示：

- 可选岗位要求文本框。
- 问题数量选择器，限制为 5 至 7，默认 6。
- `Generate questions` 主按钮。
- 生成中状态和失败重试。

问题卡片建议显示：

- 顺序、完整问题文本、目标回答时长。
- competency 标签。
- `why_it_matters`。
- profile evidence 展开区，显示 claim、profile path、来源和 evidence status。

页面主操作：

- 复制全部问题。
- 下载 Markdown 或 TXT。
- 在问题集就绪后创建 interview 并进入上传步骤。

复制内容可以由后端 document 端点获取，避免前端自行拼接导致格式漂移。

## 3. Video Upload

一期只支持选择本地视频上传，不实现浏览器录像。

建议接受：

```text
video/mp4, video/webm, video/quicktime, video/x-m4v, video/x-matroska
```

上传流程：

1. `POST /interviews`
2. `POST /interviews/{id}/video/init`
3. 按返回的 `chunk_size` 切分文件，逐片 `PUT`。
4. 全部成功调用 `complete`。

界面要求：

- 显示文件名、体积、已上传片数和真实字节进度。
- 支持取消或重新开始，重新开始应创建新 upload session。
- `complete` 返回前不要展示“上传成功”。
- 显示最长 20 分钟、最大 500 MB 的硬约束。
- 后端错误必须直接显示 `detail.detail`，尤其要区分超时长、无视频流、依赖未安装。

不建议前端计算 SHA-256；后端在完成上传时统一计算并写入报告。

## 4. Analysis State

调用 `POST /interviews/{id}/analyze` 后轮询 `GET /interviews/{id}`。

建议每 1.5 至 3 秒轮询一次，终态为：

- `completed`
- `completed_with_warnings`
- `failed`

`stage` 可映射为可读步骤：

| stage | 展示文案 |
|---|---|
| `queued` | Queued |
| `transcribing` | Transcribing English audio |
| `aligning_answers` | Mapping answers to questions |
| `analyzing_questions` | Analysing each answer |
| `completed` | Report ready |

不要根据 `progress` 显示虚假的精确百分比。`transcribing` 阶段通常是主要等待时间。

## 5. Report Layout

桌面端建议左右布局：

- 左侧：HTML5 video player、问题筛选和 transcript。
- 右侧：overall report、timestamp inventory、当前问题详情。

移动端改为上下布局，播放器在顶部并尽量保持 sticky。

### Timestamp Inventory

每条 inventory 使用 `question_id`、`start_ms`、`end_ms`、`alignment_confidence`。
点击条目时：

1. `video.currentTime = start_ms / 1000`
2. 播放对应区间
3. 高亮该问题的 `question_results.transcript_segments`

如果 `answered=false` 或起止时间为 `null`，显示未定位到回答，不显示跳转按钮。
`alignment_confidence=low` 时应加谨慎提示。

### Per-question Result

逐题展示：

- 问题与 answer window。
- summary。
- 五个评分项和 `score_overall`。
- strengths、concerns、missing details。
- 可点击的 supporting transcript segments。

单项 finding 的 `supporting_segments` 是后端校验后的真实时间片段。前端不要用模型
文本自行生成时间戳。

### Communication Profile

建议以测量面板呈现，而不是雷达图或能力画像：

- Words per minute
- Speech ratio
- Long pauses
- Filler rate
- Coverage

必须同时显示 `caveats`。不要加“自信”“诚实”“抗压能力”等推断标签。第一版没有视觉
分析字段，前端不要预留表情或眼神结论。

## 6. API 到页面的最小状态机

```text
profile selected
  -> question set ready
  -> interview created
  -> uploading
  -> uploaded
  -> analyzing
  -> completed / completed_with_warnings / failed
```

刷新页面后的恢复方式：

- 将 `questionSetId` 和 `interviewId` 保存在页面 URL 或前端本地状态。
- question set 与 interview 都已持久化，可通过 GET 端点恢复。
- 未完成的分片上传 session 不保证跨进程恢复，刷新后应从 `init` 重新开始。

## 7. 错误与空状态

必须覆盖：

- Profile 未生成或已因后端重启丢失：提示先重新分析候选人材料。
- 问题生成失败：保留岗位要求输入，允许重试。
- 视频超限、时长超限、无音轨、无视频流：显示后端具体错误。
- ASR 模型首次下载失败：提示检查网络、设备或环境配置。
- 分析失败：可重新上传或重试分析。
- `completed_with_warnings`：报告可见，但 warnings 放在显著位置。
- `question_analysis_failed`：对应问题仍显示 transcript，但分析卡片标记不可用。

## 8. 可访问性与文案

- 所有视频时间跳转按钮提供毫秒值对应的 `mm:ss` 文本。
- 时间轴按钮可用键盘操作。
- 不用颜色单独表达证据状态、对齐置信度或评分。
- 页面核心业务文案使用英文，与生成的问题和报告保持一致。
- 不显示模型内部 prompt、claim 排序分数或原始 LLM 响应。
