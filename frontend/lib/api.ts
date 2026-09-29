import type {
  CandidateProfile,
  UploadResponse,
  AnalyzeResponse,
  QAResponse,
} from "./types";

// 统一走同源相对路径 /api/*，由 Next.js rewrites 代理到后端（见 next.config.ts），避免 CORS
const API_BASE = "";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    let detail = body?.detail;
    // FastAPI 422 校验错误：detail 是数组，统一转成可读文本
    if (Array.isArray(detail)) {
      detail = detail
        .map((d: { msg?: string }) => d?.msg ?? "")
        .filter(Boolean)
        .join("；");
    } else if (detail && typeof detail === "object") {
      // 后端业务错误：detail 是对象 { code, detail }
      const d = detail as { code?: string; detail?: string };
      detail = d.detail ?? d.code ?? JSON.stringify(detail);
    }
    throw new Error(
      detail ? `请求失败：${detail}` : `请求失败（${res.status}）`,
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

// 3. 获取结构化档案（profile_id 或 upload_id 必须且只能传一个）
// 返回带 schema_version 的 CandidateProfile（已与沈一确认）。
export async function getProfile(params: {
  profile_id?: string;
  upload_id?: string;
}): Promise<CandidateProfile> {
  const { profile_id, upload_id } = params;
  const hasProfile = Boolean(profile_id);
  const hasUpload = Boolean(upload_id);
  if (hasProfile === hasUpload) {
    throw new Error("getProfile 必须且只能传 profile_id 或 upload_id 其中之一");
  }
  const query = hasProfile
    ? `profile_id=${profile_id}`
    : `upload_id=${upload_id}`;
  return request<CandidateProfile>(`${API_BASE}/api/profile?${query}`);
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
