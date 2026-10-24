# AIE1903 Project 2 — Work Plan（预筛选面试工作流）

> 依据：`Project2_Student_Guide(1).pptx` 与当前 `main` 分支的 Project 1 实现。
> 更新日期：2026-10-24

## 0. 背景与前提

Project 1（Candidate Document Intelligence）已经把候选人的 CV / Cover Letter /
Research Statement / Teaching Statement 转成结构化档案：六大模块
（basic_info、education_employment、awards_funding、publications_impact、
academic_service、overall_evaluation），每条事实带 evidence 对象（来源、链接、
摘录、证据状态、查询日期等），并提供 Web 界面。

Project 2（Adaptive Online Prescreening）在此之上加一条闭环：复用档案生成问题 →
委员会审核 → 候选人录一段视频 → 转写 → 证据关联 AI 点评。整体流程：

```text
选择档案 → 生成问题（带证据来源） → 委员会审核/发布
   → 候选人录制或上传一段视频 → 时间戳转写 → AI 点评（带时间戳摘录）
```

关键约束：P1 目前是「进程内存储 + 后台线程」，README 已注明无生产级鉴权、数据隔离
与持久化。P2 必须把档案、问题集、视频、转写落地存储，并区分委员会 / 候选人权限。

## 1. 目标清单

### R1 · 候选人生成问题

- G1：复用 P1 档案（六大模块 + evidence）与「岗位要求」输入，生成候选人专属问题集。
- G2：每题绑定证据来源（基于档案里哪条 evidence），并能解释生成方法
  （提示词 / 规则 / 检索 / 混合）。

### R2 · 委员会审核与发布

- G3：委员会视图可审阅草稿、核对证据来源、编辑 / 删除 / 新增问题并发布。
- G4：角色隔离——委员会链接与候选人链接分开，仅「已发布」问题对候选人可见。

### R3 · 候选人提交视频

- G5：候选人按顺序回答全部已批准问题，通过浏览器录制或上传一段完整视频；
  系统校验是否所有问题都已作答。

### R4 · 视频到可核验转写

- G6：视频转成带时间戳的逐句文本，保留不确定措辞；可选修正标点 / 噪声但保留
  原意与时间戳；评审可对照视频核对原文。

### R5 · 证据关联 AI 分析

- G7：输出候选人陈述摘要 + AI 评语（经历意义、优势、缺失细节），每条重要评语
  带时间戳摘录可溯源。

### R6 · 可选创新

- G8：口语特征分析（语速、停顿、流利度、回答结构），按时间预算决定做到哪一层。

### R7 · 端到端与可复现

- G9：打通 P1 + P2 本地网站，含完整源码、安装启动说明、依赖 / 配置示例、
  TA 可复现的样例输入与测试脚本。
- G10：补齐持久化与访问控制（档案、问题集、视频、转写、分析结果落地存储；
  区分委员会 / 候选人权限）。

## 2. 知识点与技能对照

| 目标 | 知识点 | 技能 / 工具 |
| --- | --- | --- |
| G1–G2 | Prompt 工程（结构化 JSON、few-shot）、证据锚定与反幻觉、检索增强（RAG） | DeepSeek / OpenAI-compatible API、jsonschema；复用 `app/qa.py` 的 evidence_ids 编号防伪 |
| G3–G4 | 状态机（draft→published）、CRUD、链接 / 令牌访问控制 | FastAPI 路由、SQLite / JSON 持久化、前端表单 |
| G5 | 浏览器音视频采集、大文件分片上传、格式与完整性校验 | MediaRecorder / getUserMedia；复用 P1 的 4MB 分片上传 |
| G6 | 语音识别（ASR）、时间戳对齐、音频抽取 | Whisper（faster-whisper 本地 / Whisper 兼容 API）、ffmpeg |
| G7 | 摘要与评语生成、时间戳摘录溯源、反幻觉引用 | LLM + 复用 evidence 引用防伪模式 |
| G8 | 副语言特征（paralinguistic features）、音频信号处理 | ffmpeg / pydub、停顿检测、WPM 计算 |
| G9–G10 | 全栈整合、持久化、访问控制、可复现工程 | FastAPI + Next.js、存储层、README / 一键启动与样例脚本 |

全局设计决策：语音转写首选本地 faster-whisper（离线、不花钱），
API 做可切换回退（快、花钱、需网络）。

## 3. 三人分工

| 成员 | 角色 | 主要交付物 |
| --- | --- | --- |
| A | 后端 + AI 流水线 | 问题生成、审核 API、AI 评语分析、数据契约与持久化、API 成本控制 |
| B | 视频 + 语音流水线 | 视频录制 / 上传后端、ffmpeg、ASR 转写、口语特征分析 |
| C | 前端 + 集成 + 文档 | 委员会视图、候选人视图、时间戳对照与证据溯源 UI、README 与可复现脚本 |

## 4. 阶段计划

| 阶段 | 内容 | 负责 |
| --- | --- | --- |
| Phase 0 | 冻结数据契约与 API 草案：Question / QuestionSet / Interview / Transcript / Analysis schema，定持久化方案（建议 SQLite）与三套页面信息架构 | A 主笔，B、C 审阅 |
| Phase 1 | A：问题生成 + 审核 API + 状态机；B：视频上传 / 录制 + 转写流水线骨架；C：委员会界面与候选人界面骨架（先接 mock） | A、B、C 并行 |
| Phase 2 | A：AI 评语分析与证据溯源、成本控制；B：转写质量 + 口语特征；C：转写 / 分析展示页与时间戳对照播放器 | A、B、C 并行 |
| Phase 3 | 端到端打通 P1→P2，权限隔离实测，处理边界（大视频、ASR 失败、部分问题未答） | 全组 |
| Phase 4 | 样例输入、安装启动说明、依赖 / 配置示例、可复现测试脚本、演示排练 | 全组 |

## 5. 依赖与风险

- C 依赖 A 的 API 契约，Phase 0 的 schema 必须先冻结，否则三人都返工。
- B 的转写结果是 A 分析的上游，转写格式（含时间戳）需在 Phase 0 定死。
- 容易低估的三点：本地视频体积、ASR 的中文 / 口音准确率、P1 内存存储升级到
  持久化的工作量。

## 6. 下一步

- [ ] 确认团队三名成员与分工（A / B / C 分别是谁）。
- [ ] 定 Phase 0 的数据契约与 API 草案。
- [ ] 从 `main` 开 `codex/project2-prescreening` 分支。
- [ ] 搭 P2 目录骨架与页面路由。
