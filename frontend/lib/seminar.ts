export type View = "speaker" | "screen";
export type Dimension = "audience_orientation" | "gesture_usage" | "posture_movement";
export type ReviewStatus = "pending" | "confirmed" | "inaccurate" | "uncertain";
export type Video = {filename: string; display_name: string; duration_ms: number; size_bytes: number};
export type Frame = {id: string; view: View; time_ms: number; source_ms: number};
export type Observation = {importance?:number; id: string; dimension: Dimension; observed_action: string; comment: string;
  frame_ids: string[]; start_ms: number; end_ms: number; review_status: ReviewStatus};
export type Seminar = {id: string; profile_id: string; title: string; updated_at: string;
  segments?: SeminarPart[]; segments_revision?: number;
  full_transcript?: {segment_id:string; start_ms:number; end_ms:number; text:string; uncertain?:boolean}[];
  script_context?:string; transcript_source?:string;
  outline_job?: {status:string; stage:string; message:string; done?:number; total?:number};
  segment_proposal?: {parts:SeminarPart[]; base_revision:number};
  videos: Partial<Record<View, Video>>; uploading_views: View[]; offset_ms: number; aligned: boolean;
  alignment_suggestion?: {offset_ms: number | null; reliable: boolean; score: number; message: string; visual_verified?: boolean; drift_detected?: boolean;
    checkpoints?: {speaker_ms:number; screen_ms:number; reliable:boolean; offset_ms:number|null}[]};
  overlap?: [number, number]; status: string; stage: string; progress: {done: number; total: number};
  warnings: string[]; error: string | null; frames: Frame[]; observations: Observation[];
  transcript: {segment_id: string; start_ms: number; end_ms: number; text: string; uncertain?: boolean}[]};
export type Summary = Pick<Seminar, "id" | "profile_id" | "title" | "status" | "updated_at"> & Partial<Pick<Seminar,"stage" | "progress" | "outline_job">>;
export async function seminarRequest<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/seminars${path}`, {method, headers: {"Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(x => x.msg).join("; ") : `Request failed (${response.status})`);
  }
  return data as T;
}
export async function uploadSeminarVideo(id: string, view: View, file: File, progress: (percent: number) => void): Promise<Seminar> {
  const base = `/${id}/videos/${view}`;
  const upload = await seminarRequest<{upload_id: string; chunk_size: number}>(base+"/init", "POST", {filename: file.name, total_bytes: file.size});
  const path = `${base}/uploads/${upload.upload_id}`;
  for (let start=0, index=0; start<file.size; start+=upload.chunk_size, index++) {
    const end = Math.min(start+upload.chunk_size, file.size);
    const response = await fetch(`/api/seminars${path}/chunks/${index}`, {method: "PUT", body: file.slice(start,end)});
    if (!response.ok) throw new Error(`Upload failed (${response.status}). Select the file again to retry.`);
    progress(Math.round(end/file.size*100));
  }
  return seminarRequest<Seminar>(path+"/complete", "POST");
}
export function timecode(ms: number) {
  const seconds=Math.floor(ms/1000);
  return `${Math.floor(seconds/60).toString().padStart(2,"0")}:${(seconds%60).toString().padStart(2,"0")}`;
}

export type PartGroup = "introduction" | "body" | "conclusion" | "other";
export type SeminarPart = {id:string; title:string; group:PartGroup; start_ms:number; end_ms:number; summary:string};
