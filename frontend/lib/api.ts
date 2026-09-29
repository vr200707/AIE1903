import type {
  Candidate,
  UploadResponse,
  AnalyzeResponse,
  QAResponse,
} from "./types";

// 后端 Base URL：联调时用环境变量 NEXT_PUBLIC_API_BASE 覆盖
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.detail ? `请求失败：${body.detail}` : `请求失败（${res.status}）`,
    );
  }
  return res.json() as Promise<T>;
}

// 1. 上传文档（multipart/form-data）
export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request<UploadResponse>(`${API_BASE}/api/upload`, {
    method: "POST",
    body: form,
  });
}

// 2. 触发抽取与分析
export async function analyze(uploadId: string): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId }),
  });
}

// 3. 获取结构化档案（profile_id 或 upload_id 二选一）
export async function getProfile(params: {
  profile_id?: string;
  upload_id?: string;
}): Promise<Candidate> {
  const query = params.profile_id
    ? `profile_id=${params.profile_id}`
    : `upload_id=${params.upload_id}`;
  return request<Candidate>(`${API_BASE}/api/profile?${query}`);
}

// 4. 问答（加分项）
export async function askQuestion(
  profileId: string,
  question: string,
): Promise<QAResponse> {
  return request<QAResponse>(`${API_BASE}/api/qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId, question }),
  });
}
