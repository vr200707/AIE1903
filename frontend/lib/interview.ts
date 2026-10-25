import type { EvidenceStatus } from "./types";

const API_BASE = "";

export type InterviewConfidence = "high" | "medium" | "low";

export type InterviewStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "analyzing"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type InterviewCompetency =
  | "research_impact"
  | "ownership_leadership"
  | "evidence_clarity"
  | "teaching"
  | "collaboration"
  | "career_motivation"
  | "other";

export interface InterviewWarning {
  code: string;
  stage: string;
  message: string;
  retryable: boolean;
  source: string | null;
}

export interface QuestionEvidence {
  source: string;
  source_url: string | null;
  excerpt: string;
  evidence_status: EvidenceStatus;
  page: number | null;
  source_type: string | null;
  profile_path: string;
}

export interface SourceClaim {
  claim_id: string;
  profile_path: string;
  category: string;
  claim: string;
  evidence_statuses: EvidenceStatus[];
  evidence: QuestionEvidence[];
}

export interface InterviewQuestion {
  question_id: string;
  order: number;
  text: string;
  competency: InterviewCompetency;
  objective: string;
  why_it_matters: string;
  answer_seconds: number;
  source_claims: SourceClaim[];
}

export interface QuestionSet {
  schema_version: "1.0.0";
  question_set_id: string;
  profile_id: string;
  status: "ready";
  language: "en";
  role_context: string | null;
  candidate_name: string | null;
  questions: InterviewQuestion[];
  generation: {
    model: string;
    requested_question_count: number;
    claim_candidates: number;
    claims_sent_to_model: number;
    input_char_budget: number;
    source_truncated: boolean;
  };
  warnings: InterviewWarning[];
  created_at: string;
}

export interface InterviewVideo {
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  duration_ms: number;
  width: number | null;
  height: number | null;
}

export interface InterviewSession {
  schema_version: "1.0.0";
  interview_id: string;
  question_set_id: string;
  status: InterviewStatus;
  stage: string;
  progress: { done: number; total: number };
  video: InterviewVideo | null;
  warnings: InterviewWarning[];
  error: { code: string; detail: string } | null;
  has_report: boolean;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegment {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface AnswerWindow {
  start_ms: number;
  end_ms: number;
}

export interface GroundedFinding {
  text: string;
  supporting_segments: TranscriptSegment[];
}

export interface OverallFinding {
  text: string;
  question_ids: string[];
  supporting_segments: TranscriptSegment[];
}

export interface QuestionScores {
  evidence_specificity: number | null;
  ownership: number | null;
  depth: number | null;
  consistency: number | null;
  communication: number | null;
}

export interface QuestionResult {
  question_id: string;
  order: number;
  question: string;
  competency: InterviewCompetency;
  answer_window: AnswerWindow | null;
  alignment_confidence: InterviewConfidence;
  answered: boolean;
  transcript_segments: TranscriptSegment[];
  summary: string;
  scores: QuestionScores;
  score_overall: number | null;
  strengths: GroundedFinding[];
  concerns: GroundedFinding[];
  missing_details: string[];
  confidence: InterviewConfidence;
}

export interface OverallReport {
  summary: string;
  strengths: OverallFinding[];
  risks: OverallFinding[];
  recommended_follow_up_questions: string[];
}

export interface TimestampInventoryItem {
  question_id: string;
  order: number;
  answered: boolean;
  start_ms: number | null;
  end_ms: number | null;
  alignment_confidence: InterviewConfidence;
  segment_ids: string[];
  profile_paths: string[];
}

export interface CommunicationMetrics {
  word_count: number;
  speech_duration_ms: number;
  speech_ratio: number;
  articulation_rate_wpm: number | null;
  overall_speech_rate_wpm: number | null;
  long_pause_count: number;
  longest_pause_ms: number;
  filler_count: number;
  filler_rate_per_100_words: number;
  mean_volume_dbfs: number | null;
  volume_variability_db: number | null;
  answered_questions: number;
  question_count: number;
  coverage_ratio: number;
}

export interface CommunicationProfile {
  metrics: CommunicationMetrics;
  interpretations: Array<{
    dimension: string;
    level: string;
    observation: string;
    confidence: InterviewConfidence;
  }>;
  caveats: string[];
}

export interface InterviewReport {
  schema_version: "1.0.0";
  interview_id: string;
  question_set_id: string;
  language: "en";
  analysis_model: string;
  generated_at: string;
  video: InterviewVideo;
  overall_report: OverallReport;
  question_results: QuestionResult[];
  timestamp_inventory: TimestampInventoryItem[];
  communication_profile: CommunicationProfile;
  warnings: InterviewWarning[];
}

export interface InterviewSessionPointer {
  questionSetId: string;
  interviewId: string | null;
  roleContext: string;
  questionCount: number;
  updatedAt: number;
}

const SESSION_PREFIX = "aie1903.interview.session.v1:";

export function readInterviewSession(profileId: string): InterviewSessionPointer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SESSION_PREFIX}${profileId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InterviewSessionPointer;
    if (!parsed?.questionSetId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeInterviewSession(
  profileId: string,
  pointer: Omit<InterviewSessionPointer, "updatedAt">,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `${SESSION_PREFIX}${profileId}`,
    JSON.stringify({ ...pointer, updatedAt: Date.now() }),
  );
}

export function clearInterviewSession(profileId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${SESSION_PREFIX}${profileId}`);
}

export function clearAllInterviewSessions(): void {
  if (typeof window === "undefined") return;
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith(SESSION_PREFIX))
    .forEach((key) => window.localStorage.removeItem(key));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    let detail = body?.detail;
    if (Array.isArray(detail)) {
      detail = detail
        .map((entry: { msg?: string }) => entry?.msg ?? "")
        .filter(Boolean)
        .join("; ");
    } else if (detail && typeof detail === "object") {
      const value = detail as { code?: string; detail?: string };
      detail = value.detail ?? value.code ?? JSON.stringify(detail);
    }
    throw new Error(
      detail ? String(detail) : `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export async function createQuestionSet(input: {
  profileId: string;
  roleContext: string;
  questionCount: number;
}): Promise<QuestionSet> {
  return request<QuestionSet>(`${API_BASE}/api/interview/question-sets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile_id: input.profileId,
      role_context: input.roleContext.trim() || null,
      question_count: input.questionCount,
      language: "en",
    }),
  });
}

export async function getQuestionSet(questionSetId: string): Promise<QuestionSet> {
  return request<QuestionSet>(
    `${API_BASE}/api/interview/question-sets/${encodeURIComponent(questionSetId)}`,
  );
}

export async function getQuestionDocument(
  questionSetId: string,
  format: "md" | "txt",
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/api/interview/question-sets/${encodeURIComponent(questionSetId)}/document?format=${format}`,
  );
  if (!response.ok) {
    throw new Error(`Could not download the question document (${response.status})`);
  }
  return response.text();
}

export async function createInterviewSession(
  questionSetId: string,
): Promise<InterviewSession> {
  return request<InterviewSession>(`${API_BASE}/api/interview/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_set_id: questionSetId }),
  });
}

export async function getInterviewSession(
  interviewId: string,
): Promise<InterviewSession> {
  return request<InterviewSession>(
    `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}`,
  );
}

export async function uploadInterviewVideo(input: {
  interviewId: string;
  file: File;
  onProgress?: (progress: {
    uploadedBytes: number;
    totalBytes: number;
    uploadedChunks: number;
    totalChunks: number;
  }) => void;
}): Promise<InterviewSession> {
  const { interviewId, file, onProgress } = input;
  const init = await request<{
    session_id: string;
    chunk_size: number;
    chunk_count: number;
    total_bytes: number;
  }>(`${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/video/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      total_bytes: file.size,
      content_type: file.type || "video/mp4",
    }),
  });
  if (!Number.isInteger(init.chunk_size) || init.chunk_size <= 0) {
    throw new Error("Upload session returned an invalid chunk size");
  }
  let uploadedBytes = 0;
  for (let chunkIndex = 0; chunkIndex < init.chunk_count; chunkIndex += 1) {
    const start = chunkIndex * init.chunk_size;
    const end = Math.min(start + init.chunk_size, file.size);
    await request<{ received: number }>(
      `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/video/sessions/${encodeURIComponent(init.session_id)}/chunks/${chunkIndex}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(start, end),
      },
    );
    uploadedBytes = end;
    onProgress?.({
      uploadedBytes,
      totalBytes: file.size,
      uploadedChunks: chunkIndex + 1,
      totalChunks: init.chunk_count,
    });
  }
  return request<InterviewSession>(
    `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/video/sessions/${encodeURIComponent(init.session_id)}/complete`,
    { method: "POST" },
  );
}

export async function startInterviewAnalysis(
  interviewId: string,
): Promise<{ interview_id: string; status: string; accepted: boolean }> {
  return request(
    `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/analyze`,
    { method: "POST" },
  );
}

export async function getInterviewReport(
  interviewId: string,
): Promise<InterviewReport> {
  return request<InterviewReport>(
    `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/report`,
  );
}

export async function deleteInterviewSession(interviewId: string): Promise<void> {
  await request<{ deleted: boolean }>(
    `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}`,
    { method: "DELETE" },
  );
}

export function interviewVideoUrl(interviewId: string): string {
  return `${API_BASE}/api/interview/interviews/${encodeURIComponent(interviewId)}/video`;
}

export function formatTimecode(milliseconds: number | null | undefined): string {
  if (milliseconds == null || milliseconds < 0) return "--:--";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function competencyLabel(value: InterviewCompetency): string {
  const labels: Record<InterviewCompetency, string> = {
    research_impact: "Research impact",
    ownership_leadership: "Ownership & leadership",
    evidence_clarity: "Evidence clarity",
    teaching: "Teaching",
    collaboration: "Collaboration",
    career_motivation: "Career motivation",
    other: "Interview signal",
  };
  return labels[value];
}

export function scoreLabel(key: keyof QuestionScores): string {
  const labels: Record<keyof QuestionScores, string> = {
    evidence_specificity: "Evidence specificity",
    ownership: "Ownership",
    depth: "Depth",
    consistency: "Consistency",
    communication: "Communication",
  };
  return labels[key];
}
