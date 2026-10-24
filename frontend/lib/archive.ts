// CV 档案库：把每次分析完成的候选人画像存档到 localStorage，
// 供左侧栏的档案库文件夹展示与一键重新打开。

import { computeCredibility } from "./scoring";
import type { Candidate, LlmAssessment } from "./types";

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

/** 写入或更新（同一 profile 覆盖），返回按时间倒序的完整列表。 */
export function upsertArchive(entry: ArchiveEntry): ArchiveEntry[] {
  const all = readAll();
  const idx = all.findIndex(
    (e) => e.id === entry.id || e.profileId === entry.profileId,
  );
  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }
  writeAll(all);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function removeArchive(id: string): ArchiveEntry[] {
  const all = readAll().filter((e) => e.id !== id);
  writeAll(all);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
