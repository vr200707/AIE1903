// 枚举 → 中文文案（D2/D3/D4 复用）
import type {
  EvidenceStatus,
  AuthorRole,
  VenueType,
  ServiceType,
  FundingRole,
} from "./types";

export const evidenceStatusLabel: Record<EvidenceStatus, string> = {
  confirmed: "Confirmed",
  not_found_public: "Not found publicly",
  to_verify: "To verify",
  conflict: "Conflict",
};

export const authorRoleLabel: Record<AuthorRole, string> = {
  first_author: "First author",
  co_first_author: "Co-first author",
  corresponding_author: "Corresponding author",
  co_corresponding_author: "Co-corresponding author",
  middle_author: "Middle author",
  single_author: "Sole author",
  unknown: "Unknown",
};

export const venueTypeLabel: Record<VenueType, string> = {
  journal: "Journal",
  conference: "Conference",
  workshop: "Workshop",
  preprint: "Preprint",
  other: "Other",
  unknown: "Unknown",
};

export const serviceTypeLabel: Record<ServiceType, string> = {
  reviewer: "Reviewer",
  editor: "Editor",
  program_committee: "Program committee",
  other: "Other",
};

export const fundingRoleLabel: Record<FundingRole, string> = {
  PI: "PI",
  "Co-PI": "Co-PI",
  participant: "Participant",
  unknown: "Unknown",
};
