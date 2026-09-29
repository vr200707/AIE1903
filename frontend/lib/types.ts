// 与沈一 docs/schema.json 对齐的 TypeScript 类型（schema_version 1.0.0）

export type EvidenceStatus =
  | "confirmed"
  | "not_found_public"
  | "to_verify"
  | "conflict";

export type SourceType =
  | "resume"
  | "supporting_document"
  | "institutional_page"
  | "publisher_page"
  | "bibliographic_database"
  | "code_repository"
  | "other";

// 日期：YYYY / YYYY-MM / YYYY-MM-DD / null
export type DateValue = string | null;

export interface Evidence {
  source: string;
  source_url: string | null;
  evidence: string;
  evidence_status: EvidenceStatus;
  query_date: string;
  page?: number | null;
  source_type?: SourceType;
  notes?: string | null;
}

export interface VerificationItem {
  claim: string;
  reason: string;
  evidence: Evidence[];
}

export interface BasicInfo {
  name: string | null;
  institution: string | null;
  position: string | null;
  research_interests: string[];
  highest_degree: string | null;
  skills: string[];
  strengths: string[];
  to_verify: VerificationItem[];
  evidence: Evidence[];
}

export interface EducationRecord {
  degree: string | null;
  field: string | null;
  institution: string | null;
  advisor: string | null;
  start_date: DateValue;
  end_date: DateValue;
  projects: string[];
  outcomes: string[];
  evidence: Evidence[];
}

export interface EmploymentRecord {
  institution: string | null;
  position: string | null;
  start_date: DateValue;
  end_date: DateValue;
  responsibilities: string[];
  projects: string[];
  outcomes: string[];
  evidence: Evidence[];
}

export interface EducationEmployment {
  education: EducationRecord[];
  employment: EmploymentRecord[];
}

export interface AwardRecord {
  name: string;
  year: number | null;
  awarding_body: string | null;
  evidence: Evidence[];
}

export type FundingRole = "PI" | "Co-PI" | "participant" | "unknown";

export interface FundingRecord {
  project_name: string;
  funder: string | null;
  start_date: DateValue;
  end_date: DateValue;
  amount: number | null;
  currency: string | null;
  role: FundingRole;
  evidence: Evidence[];
}

export interface AwardsFunding {
  awards: AwardRecord[];
  funding: FundingRecord[];
}

export type AuthorRole =
  | "first_author"
  | "co_first_author"
  | "corresponding_author"
  | "co_corresponding_author"
  | "middle_author"
  | "single_author"
  | "unknown";

export type VenueType =
  | "journal"
  | "conference"
  | "workshop"
  | "preprint"
  | "other"
  | "unknown";

export interface PublicationRecord {
  title: string;
  year: number | null;
  author_role: AuthorRole;
  venue: string | null;
  venue_type: VenueType;
  ranking: string | null;
  citation_count: number | null;
  citation_query_date: string | null;
  code_repository: string | null;
  repository_stars: number | null;
  stars_query_date: string | null;
  evidence: Evidence[];
}

export interface PublicationsImpact {
  publications: PublicationRecord[];
  total_citations: number | null;
  citation_query_date: string | null;
}

export type ServiceType = "reviewer" | "editor" | "program_committee" | "other";

export interface ServiceRecord {
  service_type: ServiceType;
  organization_or_venue: string;
  role: string | null;
  start_year: number | null;
  end_year: number | null;
  research_areas: string[];
  evidence: Evidence[];
}

export interface AcademicService {
  services: ServiceRecord[];
}

export interface EvaluationDimension {
  dimension: string;
  assessment: string;
  evidence: Evidence[];
}

export interface OverallEvaluation {
  summary: string | null;
  strengths: string[];
  risks: string[];
  dimensions: EvaluationDimension[];
}

export interface Candidate {
  basic_info: BasicInfo;
  education_employment: EducationEmployment;
  awards_funding: AwardsFunding;
  publications_impact: PublicationsImpact;
  academic_service: AcademicService;
  overall_evaluation: OverallEvaluation;
}

export interface CandidateProfile {
  schema_version: "1.0.0";
  candidate: Candidate;
}

// —— 以下为 API 请求/响应类型（对应 docs/api.md） ——

export interface UploadedDocument {
  document_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: string;
}

export interface UploadResponse {
  upload_id: string;
  documents: UploadedDocument[];
}

export interface AnalyzeResponse {
  profile_id: string;
  status: string;
  schema_version: string;
  candidate: Candidate;
}

export interface QAResponse {
  answer: string;
  confidence: string;
  evidence: Evidence[];
}
