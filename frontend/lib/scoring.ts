// 候选人画像「评分」与「可信度」两套指标，完全解耦：
//
//   1. 评分 score —— 由 DeepSeek 对「经历与成果质量」打分（0–10），
//      见后端 app/scorer.py 与 POST /api/score。缺失字段按中性处理，
//      不会因为证据未公开核验而被压低。
//   2. 可信度 credibility —— 纯规则、零 API、实时计算：
//      每条证据按「来源类型质量」加权，再乘「证据状态系数」，取模块内
//      平均后映射到 0–10。人工修改证据状态（corrections）会立即改变它。

import type {
  Candidate,
  Evidence,
  EvidenceStatus,
  LlmAssessment,
  SourceType,
} from "./types";

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

// 模块在综合可信度中的权重（可调整）。
const MODULE_WEIGHTS: Record<ModuleKey, number> = {
  basic_info: 1,
  education_employment: 1,
  awards_funding: 1.2,
  publications_impact: 1.2,
  academic_service: 0.8,
  overall_evaluation: 1,
};

export interface ModuleCredibility {
  key: ModuleKey;
  credibility: number;
  pros: string;
  cons: string;
  evidenceCount: number;
  confirmedCount: number;
  toVerifyCount: number;
  notFoundCount: number;
  conflictCount: number;
}

export interface ModuleAssessment {
  key: ModuleKey;
  title: string;
  titleEn: string;
  planet: PlanetId;
  glow: string;
  /** DeepSeek 评分；后端评分不可用时为 null。 */
  score: number | null;
  /** 规则可信度（0–10），随证据标签修改实时变化。 */
  credibility: number;
  /** 评分的一句话优劣点评（DeepSeek 输出；无评分时回退为可信度点评）。 */
  pros: string;
  cons: string;
  /** 可信度的一句话优劣点评（规则生成）。 */
  credPros: string;
  credCons: string;
  evidenceCount: number;
  confirmedCount: number;
  toVerifyCount: number;
  notFoundCount: number;
  conflictCount: number;
}

export interface CredibilityAssessment {
  overall: number;
  modules: ModuleCredibility[];
}

export interface Assessment {
  /** DeepSeek 综合评分（0–10）；不可用时为 null。 */
  overall: number | null;
  /** 规则综合可信度（0–10）。 */
  credibility: number;
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

function moduleCredibility(
  evidences: Evidence[],
  getStatus: GetStatus,
): number {
  if (evidences.length === 0) return 0;
  const sum = evidences.reduce((acc, e) => {
    return acc + sourceQuality(e.source_type) * statusCoef(getStatus(e));
  }, 0);
  return clamp10((sum / evidences.length) * 10);
}

function summarizeCredibility(
  evidences: Evidence[],
  getStatus: GetStatus,
  score: number,
): Pick<
  ModuleCredibility,
  | "pros"
  | "cons"
  | "confirmedCount"
  | "toVerifyCount"
  | "notFoundCount"
  | "conflictCount"
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

  let pros: string;
  if (score >= 7 && counts.confirmedCount >= 3) {
    pros = "来源权威，证据链完整";
  } else if (counts.confirmedCount >= 1) {
    pros = "已有公开证据支撑";
  } else if (evidences.length > 0) {
    pros = "有来源但多为自述";
  } else {
    pros = "暂无外部证据";
  }

  let cons: string;
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

/** 规则可信度：来源类型权重 × 证据状态系数，模块平均后映射到 0–10。 */
export function computeCredibility(
  candidate: Candidate,
  getStatus: GetStatus,
): CredibilityAssessment {
  const byModule = collectModuleEvidence(candidate);

  const modules = (Object.keys(MODULE_META) as ModuleKey[]).map((key) => {
    const evidences = byModule[key];
    const credibility = round1(moduleCredibility(evidences, getStatus));
    const summary = summarizeCredibility(evidences, getStatus, credibility);
    return {
      key,
      credibility,
      evidenceCount: evidences.length,
      ...summary,
    };
  });

  const totalWeight = modules.reduce(
    (acc, m) => acc + MODULE_WEIGHTS[m.key],
    0,
  );
  const weighted = modules.reduce(
    (acc, m) => acc + m.credibility * MODULE_WEIGHTS[m.key],
    0,
  );

  return { overall: round1(weighted / totalWeight), modules };
}

/** 合并「DeepSeek 评分」与「规则可信度」为总览界面所需的 Assessment。 */
export function computeAssessment(
  candidate: Candidate,
  getStatus: GetStatus,
  llm: LlmAssessment | null | undefined,
): Assessment {
  const cred = computeCredibility(candidate, getStatus);

  const modules = (Object.keys(MODULE_META) as ModuleKey[]).map((key) => {
    const meta = MODULE_META[key];
    const c = cred.modules.find((x) => x.key === key)!;
    const llmModule = llm?.modules?.[key];
    const hasLlm = typeof llmModule?.score === "number";
    return {
      key,
      title: meta.title,
      titleEn: meta.titleEn,
      planet: meta.planet,
      glow: meta.glow,
      score: hasLlm ? round1(llmModule.score) : null,
      credibility: c.credibility,
      pros: hasLlm && llmModule.pros ? llmModule.pros : c.pros,
      cons: hasLlm && llmModule.cons ? llmModule.cons : c.cons,
      credPros: c.pros,
      credCons: c.cons,
      evidenceCount: c.evidenceCount,
      confirmedCount: c.confirmedCount,
      toVerifyCount: c.toVerifyCount,
      notFoundCount: c.notFoundCount,
      conflictCount: c.conflictCount,
    };
  });

  const overall =
    typeof llm?.overall === "number" ? round1(llm.overall) : null;

  return { overall, credibility: cred.overall, modules };
}
