import type {
  CandidateProfile,
  Candidate,
  UploadResponse,
  ChunkInitResponse,
  AnalyzeResponse,
  LlmAssessment,
  QAResponse,
} from "./types";

// 统一走同源相对路径 /api/*，由 Next.js rewrites 代理到后端（见 next.config.ts），避免 CORS
const API_BASE = "";

// Next.js 代理对请求体有 10MB 缓冲上限；单文件 / 总大小超过该阈值就改走分片上传。
const CHUNK_THRESHOLD = 8 * 1024 * 1024; // 8MB，留出 multipart 开销余量

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
      detail ? `Request failed: ${detail}` : `Request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

// 1. 上传文档：小文件一次 multipart 提交；大文件分片多次请求，避免代理层 500。
export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > CHUNK_THRESHOLD) {
    return uploadFilesChunked(files);
  }
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request<UploadResponse>(`${API_BASE}/api/upload`, {
    method: "POST",
    body: form,
  });
}

async function uploadFilesChunked(files: File[]): Promise<UploadResponse> {
  const init = await request<ChunkInitResponse>(`${API_BASE}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({ filename: f.name, total_bytes: f.size })),
    }),
  });
  const chunkSize = init.chunk_size;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Upload session returned an invalid chunk size");
  }

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const chunkCount = Math.ceil(file.size / chunkSize);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      await request<{ received: number }>(
        `${API_BASE}/api/upload/session/${init.session_id}/files/${fileIndex}/chunks/${chunkIndex}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(start, end),
        },
      );
    }
  }

  return request<UploadResponse>(
    `${API_BASE}/api/upload/session/${init.session_id}/complete`,
    { method: "POST" },
  );
}

// 2. 触发抽取与分析
export async function analyze(uploadId: string): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId }),
  });
}

// 2b. 轮询异步分析进度（分析可能耗时超过代理超时，因此拆成异步任务）
export async function getAnalyzeStatus(uploadId: string): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>(`${API_BASE}/api/analyze/${uploadId}`);
}

// 2c. 对给定档案（mock / 已存档）即时获取 DeepSeek 评分。
export async function fetchScore(candidate: Candidate): Promise<LlmAssessment | null> {
  const res = await fetch(`${API_BASE}/api/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.assessment ?? null;
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
    throw new Error("getProfile requires exactly one of profile_id or upload_id");
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
