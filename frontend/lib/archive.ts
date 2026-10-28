// CV 档案库：把每次分析完成的候选人画像存档到 localStorage，
// 供左侧栏的档案库文件夹展示与一键重新打开。

import { computeCredibility } from "./scoring";
import type { Candidate, LlmAssessment } from "./types";
import type {
  InterviewCompetency,
  InterviewReport,
  QuestionScores,
} from "./interview";

/** 单道题的面试评分细则（从面试报告压缩而来，存 localStorage 用）。 */
export interface InterviewQuestionScoreRecord {
  questionId: string;
  order: number;
  text: string;
  answered: boolean;
  overall: number | null;
  competency: InterviewCompetency | null;
  scores: QuestionScores | null;
}

/** 一次面试的总体评分：平均分 + 每道题的细则分。 */
export interface InterviewScoreRecord {
  interviewId: string;
  /** 所有已作答题目 score_overall 的平均值（与报告页一致）。 */
  overall: number | null;
  answeredCount: number;
  totalCount: number;
  questions: InterviewQuestionScoreRecord[];
  updatedAt: number;
}

export interface ArchiveEntry {
  id: string;
  profileId: string;
  name: string;
  institution: string;
  position: string;
  /** DeepSeek 评分；未评分时为 null，界面回退显示可信度。 */
  score: number | null;
  /** 规则可信度（0–10）。 */
  credibility: number;
  llm?: LlmAssessment | null;
  candidate: Candidate;
  /** 面试评分：候选人上传作答视频并完成分析后写入，与总分/可信度相互独立。 */
  interviewScore?: InterviewScoreRecord | null;
  createdAt: number;
}

// v2：评分（DeepSeek）与可信度（规则）分离；旧版合成总分不再兼容。
const STORAGE_KEY = "aie1903.cv.archives.v2";

function readAll(): ArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArchiveEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ArchiveEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage 满或序列化失败时静默降级，不影响分析主流程。
  }
}

export function listArchives(): ArchiveEntry[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function getArchive(id: string): ArchiveEntry | null {
  return readAll().find((e) => e.id === id) ?? null;
}

/** 依据候选人画像计算可信度并组装档案条目（评分来自 DeepSeek）。 */
export function buildArchive(
  profileId: string,
  candidate: Candidate,
  llm?: LlmAssessment | null,
): ArchiveEntry {
  const cred = computeCredibility(candidate, (e) => e.evidence_status);
  const bi = candidate.basic_info;
  return {
    id: profileId,
    profileId,
    name: bi.name?.trim() || "Unnamed candidate",
    institution: bi.institution ?? "",
    position: bi.position ?? "",
    score: typeof llm?.overall === "number" ? llm.overall : null,
    credibility: cred.overall,
    llm: llm ?? null,
    candidate,
    createdAt: Date.now(),
  };
}

/** 把面试报告压缩成可存进档案的评分记录（总分 = 已答题平均分）。 */
export function buildInterviewScoreRecord(
  report: InterviewReport,
): InterviewScoreRecord {
  const questions: InterviewQuestionScoreRecord[] = report.question_results.map(
    (item) => ({
      questionId: item.question_id,
      order: item.order,
      text: item.question,
      answered: item.answered,
      overall: item.score_overall,
      competency: item.competency ?? null,
      scores: item.scores ?? null,
    }),
  );
  const scored = questions
    .map((item) => item.overall)
    .filter((value): value is number => value != null);
  return {
    interviewId: report.interview_id,
    overall:
      scored.length > 0
        ? scored.reduce((sum, value) => sum + value, 0) / scored.length
        : null,
    answeredCount: report.question_results.filter((item) => item.answered)
      .length,
    totalCount: report.question_results.length,
    questions,
    updatedAt: Date.now(),
  };
}

/** 写入或更新（同一 profile 覆盖），返回按时间倒序的完整列表。 */
export function upsertArchive(entry: ArchiveEntry): ArchiveEntry[] {
  const all = readAll();
  const idx = all.findIndex(
    (e) => e.id === entry.id || e.profileId === entry.profileId,
  );
  if (idx >= 0) {
    // 重新分析 CV 时保留已保存的面试评分，避免被覆盖丢失。
    all[idx] = {
      ...entry,
      interviewScore: entry.interviewScore ?? all[idx].interviewScore,
    };
  } else {
    all.push(entry);
  }
  writeAll(all);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** 只更新某档案的面试评分，其他字段（DeepSeek 总分、可信度等）保持不变。 */
export function updateArchiveInterviewScore(
  profileId: string,
  record: InterviewScoreRecord,
): ArchiveEntry[] {
  const all = readAll();
  const idx = all.findIndex(
    (e) => e.id === profileId || e.profileId === profileId,
  );
  if (idx >= 0) {
    all[idx] = { ...all[idx], interviewScore: record };
    writeAll(all);
  }
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function removeArchive(id: string): ArchiveEntry[] {
  const all = readAll().filter((e) => e.id !== id);
  writeAll(all);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function clearArchives(): void {
  writeAll([]);
}
