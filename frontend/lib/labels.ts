// 枚举 → 中文文案（D2/D3/D4 复用）
import type {
  EvidenceStatus,
  AuthorRole,
  VenueType,
  ServiceType,
  FundingRole,
} from "./types";

export const evidenceStatusLabel: Record<EvidenceStatus, string> = {
  confirmed: "已确认",
  not_found_public: "未找到公开证据",
  to_verify: "待核实",
  conflict: "冲突",
};

export const authorRoleLabel: Record<AuthorRole, string> = {
  first_author: "第一作者",
  co_first_author: "共同第一作者",
  corresponding_author: "通讯作者",
  co_corresponding_author: "共同通讯作者",
  middle_author: "中间作者",
  single_author: "独立作者",
  unknown: "未知",
};

export const venueTypeLabel: Record<VenueType, string> = {
  journal: "期刊",
  conference: "会议",
  workshop: "研讨会",
  preprint: "预印本",
  other: "其他",
  unknown: "未知",
};

export const serviceTypeLabel: Record<ServiceType, string> = {
  reviewer: "审稿人",
  editor: "编辑",
  program_committee: "程序委员会",
  other: "其他",
};

export const fundingRoleLabel: Record<FundingRole, string> = {
  PI: "PI",
  "Co-PI": "Co-PI",
  participant: "参与者",
  unknown: "未知",
};
