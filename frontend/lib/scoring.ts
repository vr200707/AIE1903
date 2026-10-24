// 候选人画像评分逻辑。
//
// 评分由两部分合成（默认 0.7 / 0.3）：
//   1. 证据分 evidenceScore —— 纯规则、零 API、实时计算：
//      每条证据按「来源类型质量」加权，再乘「证据状态系数」，取模块内平均后映射到 0–10。
//      人工修改证据状态（corrections）会立即改变该分数。
//   2. 质量分 qualityScore —— 对获奖/资助/教育/任职/论文等经历的评估：
//      当前用确定性规则给出保守估计，后续可替换为 DeepSeek 等 LLM 的评估结果。

import type { Candidate, Evidence, EvidenceStatus, SourceType } from "./types";

export type ModuleKey =
  | "basic_info"
  | "education_employment"
  | "awards_funding"
  | "publications_impact"
  | "academic_service"
  | "overall_evaluation";

export type PlanetId =
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "venus"
  | "neptune";

export const MODULE_META: Record<
  ModuleKey,
  { title: string; titleEn: string; planet: PlanetId; glow: string }
> = {
  basic_info: {
    title: "基本信息",
    titleEn: "Basic Info",
    planet: "earth",
    glow: "rgba(90, 169, 255, 0.55)",
  },
  education_employment: {
    title: "教育与任职",
    titleEn: "Education & Employment",
    planet: "mars",
    glow: "rgba(245, 120, 60, 0.5)",
  },
  awards_funding: {
    title: "奖项与资助",
    titleEn: "Awards & Funding",
    planet: "jupiter",
    glow: "rgba(220, 180, 140, 0.55)",
  },
  publications_impact: {
    title: "论文与影响力",
    titleEn: "Publications & Impact",
    planet: "saturn",
    glow: "rgba(230, 200, 140, 0.5)",
  },
  academic_service: {
    title: "学术服务",
    titleEn: "Academic Service",
    planet: "venus",
    glow: "rgba(255, 220, 170, 0.5)",
  },
  overall_evaluation: {
    title: "综合评价",
    titleEn: "Overall Evaluation",
    planet: "neptune",
    glow: "rgba(90, 140, 255, 0.55)",
  },
};

// 来源类型 → 可靠性权重（0–1）。越高越可信。
const SOURCE_QUALITY: Record<SourceType, number> = {
  institutional_page: 1,
  publisher_page: 1,
  bibliographic_database: 1,
  code_repository: 0.7,
  resume: 0.4,
  supporting_document: 0.4,
  other: 0.5,
};

// 证据状态 → 系数。人工修改标签就是改这个系数。
const STATUS_COEF: Record<EvidenceStatus, number> = {
  confirmed: 1,
  to_verify: 0.5,
  not_found_public: 0.2,
  conflict: 0,
};

// 模块在综合分中的权重（可调整）。
const MODULE_WEIGHTS: Record<ModuleKey, number> = {
  basic_info: 1,
  education_employment: 1,
  awards_funding: 1.2,
  publications_impact: 1.2,
  academic_service: 0.8,
  overall_evaluation: 1,
};

const EVIDENCE_WEIGHT = 0.7;
const QUALITY_WEIGHT = 0.3;

export interface ModuleAssessment {
  key: ModuleKey;
  title: string;
  titleEn: string;
  planet: PlanetId;
  glow: string;
  score: number;
  evidenceScore: number;
  qualityScore: number;
  pros: string;
  cons: string;
  evidenceCount: number;
  confirmedCount: number;
  toVerifyCount: number;
  notFoundCount: number;
  conflictCount: number;
}

export interface Assessment {
  overall: number;
  modules: ModuleAssessment[];
}

function clamp10(v: number): number {
  return Math.min(10, Math.max(0, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function sourceQuality(type?: SourceType): number {
  return type ? SOURCE_QUALITY[type] : 0.5;
}

export function statusCoef(status: EvidenceStatus): number {
  return STATUS_COEF[status];
}

type GetStatus = (e: Evidence) => EvidenceStatus;

export function collectModuleEvidence(
  candidate: Candidate,
): Record<ModuleKey, Evidence[]> {
  return {
    basic_info: [
      ...candidate.basic_info.evidence,
      ...candidate.basic_info.to_verify.flatMap((v) => v.evidence),
    ],
    education_employment: [
      ...candidate.education_employment.education.flatMap((x) => x.evidence),
      ...candidate.education_employment.employment.flatMap((x) => x.evidence),
    ],
    awards_funding: [
      ...candidate.awards_funding.awards.flatMap((x) => x.evidence),
      ...candidate.awards_funding.funding.flatMap((x) => x.evidence),
    ],
    publications_impact: candidate.publications_impact.publications.flatMap(
      (x) => x.evidence,
    ),
    academic_service: candidate.academic_service.services.flatMap(
      (x) => x.evidence,
    ),
    overall_evaluation: candidate.overall_evaluation.dimensions.flatMap(
      (x) => x.evidence,
    ),
  };
}

export function getModuleEvidence(
  candidate: Candidate,
  key: ModuleKey,
): Evidence[] {
  return collectModuleEvidence(candidate)[key];
}

function evidenceScore(evidences: Evidence[], getStatus: GetStatus): number {
  if (evidences.length === 0) return 0;
  const sum = evidences.reduce((acc, e) => {
    return acc + sourceQuality(e.source_type) * statusCoef(getStatus(e));
  }, 0);
  return clamp10((sum / evidences.length) * 10);
}

// 规则化的经历质量分（0–10），作为无 LLM 时的兜底。
function qualityScore(c: Candidate, key: ModuleKey): number {
  switch (key) {
    case "basic_info": {
      const b = c.basic_info;
      return clamp10(
        3 +
          (b.name ? 1 : 0) +
          (b.institution ? 1 : 0) +
          (b.position ? 1 : 0) +
          (b.highest_degree ? 0.8 : 0) +
          Math.min(1.2, b.research_interests.length * 0.3) +
          Math.min(1, b.skills.length * 0.25),
      );
    }
    case "education_employment": {
      const e = c.education_employment;
      const hasAdvisor = e.education.some((x) => x.advisor);
      const hasOutcome =
        e.education.some((x) => x.outcomes.length > 0) ||
        e.employment.some((x) => x.outcomes.length > 0);
      return clamp10(
        2 +
          Math.min(2.4, e.education.length * 1.2) +
          Math.min(2.4, e.employment.length * 1.2) +
          (hasAdvisor ? 0.8 : 0) +
          (hasOutcome ? 0.8 : 0),
      );
    }
    case "awards_funding": {
      const a = c.awards_funding;
      const seniorRole = a.funding.some((x) => x.role === "PI" || x.role === "Co-PI");
      return clamp10(
        2 +
          Math.min(3, a.awards.length * 1.5) +
          Math.min(3, a.funding.length * 1.5) +
          (seniorRole ? 1 : 0),
      );
    }
    case "publications_impact": {
      const p = c.publications_impact;
      const citations = p.total_citations ?? 0;
      const hasRanking = p.publications.some((x) => x.ranking);
      const leadRole = p.publications.some(
        (x) =>
          x.author_role === "first_author" ||
          x.author_role === "co_first_author" ||
          x.author_role === "corresponding_author" ||
          x.author_role === "single_author",
      );
      return clamp10(
        2 +
          Math.min(3, p.publications.length * 0.7) +
          Math.min(2.5, citations / 400) +
          (hasRanking ? 0.8 : 0) +
          (leadRole ? 0.7 : 0),
      );
    }
    case "academic_service": {
      const s = c.academic_service;
      const hasEditor = s.services.some((x) => x.service_type === "editor");
      const hasReviewer = s.services.some((x) => x.service_type === "reviewer");
      return clamp10(
        2 +
          Math.min(3.5, s.services.length * 1.1) +
          (hasEditor ? 1.2 : 0) +
          (hasReviewer ? 0.6 : 0),
      );
    }
    case "overall_evaluation": {
      const o = c.overall_evaluation;
      return clamp10(
        3 +
          Math.min(2, o.strengths.length * 0.5) -
          Math.min(2, o.risks.length * 0.5) +
          Math.min(1.5, o.dimensions.length * 0.35),
      );
    }
  }
}

function summarize(
  key: ModuleKey,
  evidences: Evidence[],
  getStatus: GetStatus,
): Pick<
  ModuleAssessment,
  "pros" | "cons" | "confirmedCount" | "toVerifyCount" | "notFoundCount" | "conflictCount"
> {
  const counts = {
    confirmedCount: 0,
    toVerifyCount: 0,
    notFoundCount: 0,
    conflictCount: 0,
  };
  for (const e of evidences) {
    const s = getStatus(e);
    if (s === "confirmed") counts.confirmedCount += 1;
    else if (s === "to_verify") counts.toVerifyCount += 1;
    else if (s === "not_found_public") counts.notFoundCount += 1;
    else if (s === "conflict") counts.conflictCount += 1;
  }

  const score = evidenceScore(evidences, getStatus);
  let pros: string;
  let cons: string;

  if (score >= 7 && counts.confirmedCount >= 3) {
    pros = "来源权威，证据链完整";
  } else if (counts.confirmedCount >= 1) {
    pros = "已有公开证据支撑";
  } else if (evidences.length > 0) {
    pros = "有来源但多为自述";
  } else {
    pros = "暂无外部证据";
  }

  if (counts.conflictCount > 0) {
    cons = `${counts.conflictCount} 条证据存在冲突`;
  } else if (counts.notFoundCount > 0) {
    cons = `${counts.notFoundCount} 条来源公开检索不到`;
  } else if (counts.toVerifyCount > 0) {
    cons = `${counts.toVerifyCount} 条证据待核实`;
  } else if (evidences.length === 0) {
    cons = "缺少公开证据";
  } else {
    cons = "无明显短板";
  }

  return { pros, cons, ...counts };
}

export function computeAssessment(
  candidate: Candidate,
  getStatus: GetStatus,
): Assessment {
  const byModule = collectModuleEvidence(candidate);

  const modules = (Object.keys(MODULE_META) as ModuleKey[]).map((key) => {
    const meta = MODULE_META[key];
    const evidences = byModule[key];
    const evScore = evidenceScore(evidences, getStatus);
    const qScore = qualityScore(candidate, key);
    const score = round1(
      clamp10(EVIDENCE_WEIGHT * evScore + QUALITY_WEIGHT * qScore),
    );
    const summary = summarize(key, evidences, getStatus);
    return {
      key,
      title: meta.title,
      titleEn: meta.titleEn,
      planet: meta.planet,
      glow: meta.glow,
      score,
      evidenceScore: round1(evScore),
      qualityScore: round1(qScore),
      evidenceCount: evidences.length,
      ...summary,
    };
  });

  const totalWeight = modules.reduce(
    (acc, m) => acc + MODULE_WEIGHTS[m.key],
    0,
  );
  const weighted = modules.reduce(
    (acc, m) => acc + m.score * MODULE_WEIGHTS[m.key],
    0,
  );
  const overall = round1(weighted / totalWeight);

  return { overall, modules };
}
