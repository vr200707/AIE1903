# Video Interview Backend

本文档定义面向考官的英文视频面试工作流。前端数据契约以
[`contracts/interview.schema.json`](../contracts/interview.schema.json) 为准。

## 1. 能力范围

- 从已有 `profile_id` 生成 5 至 7 道英文问题。
- 问题只引用 profile 中真实存在的 claim、profile path 和 evidence。
- 将问题清单一键下载为 Markdown 或 TXT。
- 上传单个视频文件，复用 4 MB 分片传输。
- 使用本地 `faster-whisper` 生成英文 transcript segment 和毫秒时间戳。
- 将连续视频回答按 segment ID 对齐到问题。
- 逐题输出评析、分数、缺失信息和可点击时间戳。
- 汇总形成 `timestamp_inventory` 和沟通表现 profile。
- 不包含委员会审核、发布、候选人登录或浏览器录像功能。
- 第一版不分析人脸、表情、手势或其他视觉信号。

## 2. 核心数据流

```text
profile_id
  -> compact evidence claims
  -> DeepSeek English question set
  -> downloadable Markdown/TXT
  -> interview
  -> chunked video upload
  -> PyAV media probe
  -> local English ASR with segment timestamps
  -> DeepSeek assigns transcript segment IDs to questions
  -> context-bounded per-question analysis
  -> compact cross-question synthesis
  -> report + timestamp inventory
```

模型不返回时间戳。它只能返回 `segment_id`、`question_id` 和文本；后端使用原始
transcript 把 ID 还原成 `start_ms`、`end_ms` 和引用原文。无效 ID 会被丢弃并产生
warning。

## 3. DeepSeek 长上下文处理

默认 `INTERVIEW_LLM_INPUT_CHAR_BUDGET=24000`，这是一个不依赖具体 tokenizer 的保守
字符预算。所有面试模型请求都经过 `app/interview_llm.py` 的统一硬限制。

处理策略：

1. 问题生成只发送排序后的精简 claim 候选，不发送完整 profile 和全部 evidence。
2. transcript 对齐按 segment 分批，每批携带完整问题目录，只返回本批内合法 ID。
3. 单题回答过长时先做 chunk observations，再做单题综合，属于 map-reduce。
4. 跨题汇总只接收精简的逐题结果，不接收完整 transcript。
5. 任何 JSON 输出都在后端归一化、限长、验证 ID 后再返回前端。
6. 发生 `answer_context_map_reduce` warning 时，报告仍有效，但评审应关注对齐和引用。

## 4. 状态

Interview 状态：

| 状态 | 含义 |
|---|---|
| `created` | 已创建，尚无完整视频 |
| `uploading` | 正在分片上传 |
| `uploaded` | 视频已校验，可开始分析 |
| `analyzing` | 异步分析中 |
| `completed` | 分析完成 |
| `completed_with_warnings` | 完成，但存在可展示的降级项 |
| `failed` | 上传或分析失败，可重新上传/分析 |

Question set 只有 `ready` 状态，因为本网站面向考官，没有审核发布流程。

## 5. 端点

所有路径前缀为 `/api/interview`。

### 5.1 生成问题集

`POST /question-sets`

请求：

```json
{
  "profile_id": "prf_01J0ZYXWVU",
  "role_context": "Tenure-track faculty position in trustworthy AI.",
  "question_count": 6,
  "language": "en"
}
```

`role_context` 可选，最长按 4000 字符处理。`question_count` 只能为 5、6 或 7。
响应 `201`，结构见 `$defs.QuestionSet`。

### 5.2 读取问题集

`GET /question-sets/{question_set_id}`

返回同一 QuestionSet 对象。

### 5.3 下载问题清单

`GET /question-sets/{question_set_id}/document?format=md`

`format` 支持 `md` 和 `txt`。响应带 `Content-Disposition: attachment`，前端可直接
打开或下载。

### 5.4 创建 interview

`POST /interviews`

```json
{"question_set_id": "qset_01J0ABCDEF"}
```

响应 `201`：

```json
{
  "schema_version": "1.0.0",
  "interview_id": "int_01J0ABCDEF",
  "question_set_id": "qset_01J0ABCDEF",
  "status": "created",
  "stage": "created",
  "progress": {"done": 0, "total": 0},
  "video": null,
  "warnings": [],
  "error": null,
  "has_report": false
}
```

### 5.5 初始化视频上传

`POST /interviews/{interview_id}/video/init`

```json
{
  "filename": "interview.mp4",
  "total_bytes": 73400320,
  "content_type": "video/mp4"
}
```

允许扩展名：`.mp4`、`.m4v`、`.mov`、`.webm`、`.mkv`。

响应 `201`：

```json
{
  "session_id": "vup_01J0ABCDEF",
  "chunk_size": 4194304,
  "chunk_count": 18,
  "total_bytes": 73400320
}
```

### 5.6 上传分片

`PUT /interviews/{interview_id}/video/sessions/{session_id}/chunks/{chunk_index}`

- 请求体为 `application/octet-stream`。
- 除最后一片外，每片必须恰好为 `chunk_size`。
- 服务端按字节数校验，分片可以重传覆盖。

### 5.7 完成视频上传

`POST /interviews/{interview_id}/video/sessions/{session_id}/complete`

服务端合并分片、计算 SHA-256、读取媒体时长和分辨率。非法视频、无视频流或超时长
会返回错误，interview 回到可重新上传状态。

可选 JSON 请求体（候选人使用浏览器录制时为必传项）：

```json
{
  "question_marks": [
    {"question_id": "q_01J0ABCDEF", "start_ms": 0},
    {"question_id": "q_02J0ABCDEF", "start_ms": 41230}
  ]
}
```

`question_marks`（分题边界时间戳）由前端录制器在每次点击「下一题」时记录。它会被
写入 interview 的 `video.question_marks`，分析完成后优先作为切片窗口的权威依据；
转录对齐（transcription alignment）只作为没有录制元数据时的兜底。服务端会去重、
校验非负整数并把时间钳制到视频总时长内。

### 5.8 启动分析

`POST /interviews/{interview_id}/analyze`

首次提交返回 `202`：

```json
{"interview_id": "int_01J0ABCDEF", "status": "analyzing", "accepted": true}
```

已完成时返回 `200` 且 `accepted=false`；正在分析时返回 `202`，前端继续轮询。

### 5.9 查询状态

`GET /interviews/{interview_id}`

前端轮询此端点。`stage` 会依次进入 `transcribing`、`aligning_answers`、
`analyzing_questions`、`clipping_answers`、`completed`。`progress` 是粗粒度进度，
不应作为精确百分比。

### 5.10 播放视频

`GET /interviews/{interview_id}/video`

返回已上传的本地视频，媒体类型取自 interview 元数据。前端可直接把该地址赋给
`<video src>`。Starlette `FileResponse` 负责处理浏览器发起的 Range 请求，因此可拖动
进度条定位到 `timestamp_inventory` 中的时间点。

### 5.11 获取报告

`GET /interviews/{interview_id}/report`

报告结构见 `$defs.InterviewReport`。如果仍在分析，返回 `409 analysis_in_progress`。

关键字段：

- `overall_report`：跨题总结、优势、风险和建议追问。
- `question_results`：逐题 transcript 引用、评分、优势、关注点和缺失信息。
- `timestamp_inventory`：前端视频时间轴的主索引。
- `communication_profile`：语速、停顿、填充词、覆盖率等可测量信号。
- `warnings`：对齐失败、模型失败、map-reduce 或无效引用等降级信息。

### 5.12 获取完整转录

`GET /interviews/{interview_id}/transcript`

返回 `transcribe_video` 落库的完整转录对象，结构为：

```json
{
  "language": "en",
  "language_probability": 0.99,
  "duration_ms": 245000,
  "segments": [
    {
      "segment_id": "s00001",
      "start_ms": 0,
      "end_ms": 4800,
      "text": "I led the migration project.",
      "avg_logprob": -0.28,
      "no_speech_prob": 0.03,
      "uncertain": false
    }
  ],
  "asr": {"provider": "faster-whisper", "model": "small", "device": "cpu", "compute_type": "int8"}
}
```

每个 segment 附带 ASR 自身的不确定度信号：

- `avg_logprob`：该段平均词级对数概率（越低越不确定）。
- `no_speech_prob`：模型认为该段不是语音的概率。
- `uncertain`：`no_speech_prob > 0.35` 或 `avg_logprob < -1.1` 时为 `true`，
  表示措辞需要人工复核（课程要求保留“uncertain wording”供审阅）。

转录在分析完成前即已落库；仍在转写时返回 `409 analysis_in_progress`，未上传视频或
未开始分析时返回 `409 transcript_not_ready`。

### 5.13 分题片段（answer clips）

`GET /interviews/{interview_id}/clips`

返回每个题目的切片可用性：

```json
{
  "interview_id": "int_01J0ABCDEF",
  "clips": [
    {"question_id": "q_01J0ABCDEF", "available": true, "url": "/api/interview/interviews/int_01J0ABCDEF/clips/q_01J0ABCDEF"}
  ]
}
```

`GET /interviews/{interview_id}/clips/{question_id}` 返回 `video/mp4`。切片窗口优先
使用 `question_marks`（见 5.7），否则回退到 `timestamp_inventory` 的转录对齐结果；
空窗口（例如候选人在下一题秒切）不生成切片。切片文件在删除 interview 时一并清理。

### 5.14 删除 interview

`DELETE /interviews/{interview_id}`

删除 SQLite 元数据和该 interview 的本地视频目录。分析运行中返回 `409`。

## 6. 沟通表现口径

`communication_profile.metrics` 是客观测量，不是“人格”或“能力”分数：

- `articulation_rate_wpm`：只按检测到语音的时长计算。
- `overall_speech_rate_wpm`：按完整视频时长计算。
- `long_pause_count`：转录 segment 之间至少 700 ms 的间隔。
- `filler_rate_per_100_words`：`um`、`uh`、`erm`、`hmm` 等显式填充词。
- `mean_volume_dbfs` 与 `volume_variability_db`：语音区间能量统计。
- `coverage_ratio`：找到可定位回答的问题比例。

报告必须同时显示 `caveats`。这些指标不能直接解释为紧张、自信、诚信或职业能力。

## 7. 存储与隐私

- 元数据：`.cache/interview/interview.sqlite3`
- 视频：`.cache/interview/interviews/{interview_id}/`
- 上传临时分片：`.cache/interview/upload-sessions/`
- Whisper 模型：`.cache/whisper-models/`

这些目录均在本地且不进入 Git。当前仍是课程演示级单进程存储，不提供多租户鉴权。

## 8. 配置

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `INTERVIEW_DATA_DIR` | `.cache/interview` | 元数据和视频根目录 |
| `INTERVIEW_MAX_VIDEO_BYTES` | `524288000` | 单视频大小上限 |
| `INTERVIEW_MAX_VIDEO_SECONDS` | `1200` | 单视频时长上限 |
| `INTERVIEW_ASR_MODEL` | `small.en` | 本地英文 Whisper 模型 |
| `INTERVIEW_ASR_DEVICE` | `cpu` | 稳妥默认；配置 CUDA/cuDNN 后可显式改为 `cuda` |
| `INTERVIEW_ASR_COMPUTE_TYPE` | `int8` | CTranslate2 计算类型 |
| `INTERVIEW_ASR_DOWNLOAD_ROOT` | `.cache/whisper-models` | 模型缓存目录 |
| `INTERVIEW_LLM_INPUT_CHAR_BUDGET` | `24000` | 单次 DeepSeek 输入硬限制 |
| `INTERVIEW_LLM_MAX_OUTPUT_TOKENS` | `4096` | 单次输出上限 |
| `INTERVIEW_ANALYSIS_WORKERS` | `2` | 面试异步分析并发数 |

首次调用 ASR 会下载 `small.en` 模型。若下载或 GPU 运行失败，先检查
`GET /interviews/{id}` 中的 `error.code`，再根据错误切换
`INTERVIEW_ASR_DEVICE=cpu` 或不同 compute type。
