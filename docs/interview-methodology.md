# Video Interview 方法说明（Question Generation & Cost Control）

本文档说明面试环节的两个核心问题：问题从哪里来（如何生成、如何锚定证据），
以及钱花在哪里（API 成本控制）。所有数值与行为均以 `app/interview_questions.py`、
`app/interview_llm.py`、`app/interview_media.py`、`app/interview_service.py` 的
当前实现为准。

## 1. 面试题生成方法（Question Generation）

### 1.1 输入

生成器只接受两类输入：

- 候选人档案（P1 的结构化结果，含每条事实的 `evidence` 列表与
  `evidence_status`）；以及
- 委员会填写的目标岗位描述（role context）。

生成器**不接收** CV 原文，也**不允许**模型凭空补充事实：系统提示词明确要求
“Use only the supplied candidate claims. Never invent achievements, numbers,
institutions, publications, awards, or evidence.”（只使用给定的候选人声明，
不得编造成就、数字、机构、论文、奖项或证据）。

### 1.2 事实筛选（Claim Selection）

档案事实先按两条规则排序，再取前 `MAX_CLAIM_CANDIDATES = 36` 条进入候选池：

- 证据状态权重 `STATUS_RANK`：`conflict` / `to_verify` 最高（5），
  `not_found_public` 次之（3），`confirmed` 最低（1）。有冲突或待核实的
  声明优先入题，因为面试正是澄清它们的机会。
- 类别权重 `CATEGORY_RANK`：`publication`、`funding`、`verification`
  最高，`award`、`employment` 次之，`education`、`service` 更低。

每条事实最多附带 `MAX_SOURCE_REFS_PER_CLAIM = 4` 条证据引用，每条证据摘录
截断至 `MAX_EXCERPT_CHARS = 420` 字符。

### 1.3 规则约束（Constraints）

题量约束：`QUESTION_MIN = 5`、`QUESTION_MAX = 7`、默认
`DEFAULT_QUESTION_COUNT = 6`。

每题作答时长在提交时被钳制在 `45–180` 秒，默认 `90` 秒。

能力维度（competency）限定为七个枚举值：`research_impact`、
`ownership_leadership`、`evidence_clarity`、`teaching`、`collaboration`、
`career_motivation`、`other`。

系统提示词的选题规则包括：优先选择能区分候选人的关键成果/经费/奖项/领导经历；
不生成读 CV 就能回答的低价值题；不重复问同一事实；按“背景与代表作 → 个人贡献
→ 不确定声明 → 教学/合作 → 未来方向”递进；不询问受保护或无关的个人特征；
题目与理由必须使用自然英语。

### 1.4 证据锚定（Evidence Anchoring）

每道题必须携带 `claim_ids`（至少一个），题目在档案里的出处因此可追溯。
生成结果会校验 `claim_ids` 确实存在于输入事实集中；引用无效或与已有题目
重复的题会被丢弃。委员会端每道题下方可直接展开这些 claim 的原始文本与
证据摘录。

模型调用失败时存在**确定性回退生成器**（fallback question templates）：
按事实类别和变体编号产出模板化问题，保证在 DeepSeek 不可用时委员会仍然
能拿到可编辑的草稿题；使用回退时会记录 `question_fallback_used` 警告。

## 2. 面试视频分析方法（Analysis Pipeline）

1. **本地转写（local ASR）**：`transcribe_video` 使用 faster-whisper
  （默认模型 `small.en`，设备 `cpu`，计算类型 `int8`，模型缓存于
  `.cache/whisper-models/`），带 VAD 过滤（Voice Activity Detection），
  输出带时间戳的英文段落（segment）。模型在本机运行，不调用付费 API。
2. **不确定措辞标记（uncertain wording）**：每个 segment 记录
  `avg_logprob` 与 `no_speech_prob`；当 `no_speech_prob > 0.35` 或
  `avg_logprob < -1.1` 时 `uncertain = true`。审阅端在完整转录时间轴中
  用琥珀色高亮这些段落并标注 “review”，满足课程对“保留不确定措辞供复核”
  的要求。
3. **答案窗口对齐（answer alignment）**：`align_answers` 把转录段落分批
  发给 DeepSeek，由模型仅用 `start_segment_id` / `end_segment_id` 标出
  每道题对应的段落区间。候选人在录制端记录的逐题时间戳
  （`question_marks`）优先于模型对齐结果，作为最终切片窗口。
4. **逐题评析（question analysis）**：对每道已对齐的题目调用 DeepSeek，
  输出摘要、五项评分（evidence_specificity / ownership / depth /
  consistency / communication）、带段落实证的优势与关注点、缺失细节。
  跨题总结再用一次调用合成（map-reduce）。
5. **沟通表现测量（communication metrics）**：语速、停顿、填充词、
  覆盖率等由音频信号本地计算，不依赖 LLM。

## 3. API 成本控制（Cost Controls）

这是面试环节的全部模型调用：题集生成 1 次、答案对齐按转录分批若干次、
逐题评析 N 次、跨题总结 1 次。控制手段如下，均有代码对应：

### 3.1 本地转写不花钱

ASR 是 faster-whisper 本地推理（`app/interview_media.py` 的 `_get_model` /
`transcribe_video`），只消耗本机算力，不产生 API 费用。DeepSeek 永远
不接触音视频原始字节，只看到转写文本。

### 3.2 单次输入字符预算（input char budget）

`app/interview_llm.py` 的 `input_char_budget()` 默认
`DEFAULT_INPUT_CHAR_BUDGET = 24_000` 字符（环境变量
`INTERVIEW_LLM_INPUT_CHAR_BUDGET`，最小 6 000）。这是一个比“按 token
估算”更保守的硬上限。

题集生成侧的 `_fit_claims_to_budget` 在预算内分级压缩：先把每条证据摘录
依次降到 220 / 120 / 60 / 0 字符，再逐步减少事实条数（32 → 24 → 18 →
12 → 8），最后兜底只保留 6 条事实且不带摘录。若发生截断，
`generation.source_truncated = true` 会被写入题集并在界面提示。

答案对齐侧同样用 `pack_segments` 把转录按剩余预算分批，避免整段转录
一次性进上下文。

### 3.3 重复分析保护（duplicate-analysis guard）

`app/interview_service.py` 的 `start_interview_analysis` 在
`analyzing` 或 `completed` / `completed_with_warnings` 状态下直接返回
`accepted: false`，不再入队。同一个 interview 只有一次分析机会，
不会因为重复点击产生重复计费。

### 3.4 只分析已批准的题目子集（approved subset）

候选端只能看到已批准（approved）且已发布（published）的题目
（`get_candidate_question_set`）；分析流水线
（`_run_interview_analysis`）也只对 approved 子集做对齐与逐题评析。
委员会删掉的题永远不会进入付费调用。

## 4. 局限性与边界（Limitations）

- LLM 的评语与评分是判断辅助，不是事实结论；最终录用判断属于人类
  委员会。报告界面明确声明“no hire or no-hire recommendation”。
- 本地 Whisper 对无语音视频会直接拒绝（`no_audio_stream` /
  `no_speech_detected`），合成视频无法通过该环节；候选人必须真实口述。
- 转写不确定（uncertain）的措辞只是提示人工复核的信号，不自动修正原文。
- 对齐与逐题评析都依赖 DeepSeek 可用性；失败时降级为 `warning`，
  评分可能缺失但时间戳与转录仍保留。

## 5. 相关文档

- 端点与错误约定：[interview-api.md](interview-api.md)
- P1 档案生成方法：[methodology.md](methodology.md)
- 运行与故障排查：[operations.md](operations.md)
