// 面试官视角的候选人多维人物画像（纯前端、零 API 推导）。
//
// 数据完全来自现有分析结果：Candidate（硬数据）与 LlmAssessment（DeepSeek 模块分）。
// 六个维度均输出 0–100 分（雷达图约定：分数越高越强；risk_control 越高代表
// 未闭合的风险/核验缺口越少），并附英文依据，保证每个结论可追溯到材料。
// 空数据安全：任何模块缺失都回退到中性/低分并在 basis 中注明，不会抛错。

import type {
  AuthorRole,
  Candidate,
  Evidence,
  LlmAssessment,
} from "./types";

export type PersonaDimensionKey =
  | "academic_influence"
  | "research_output"
  | "funding_awards"
  | "service_collaboration"
  | "career_trajectory"
  | "risk_control";

export type PersonaLevel =
  | "Emerging"
  | "Developing"
  | "Strong"
  | "Outstanding"
  | "Exceptional";

export interface PersonaDimension {
  key: PersonaDimensionKey;
  label: string;
  /** 0–100，雷达图轴向统一为「越高越强」。 */
  score: number;
  level: PersonaLevel;
  /** 该分数的材料依据（英文短句）。 */
  basis: string[];
}

export interface Persona {
  /** 一句话人物画像概述。 */
  headline: string;
  dimensions: PersonaDimension[];
  /** 人物标签，最多 4 个。 */
  tags: string[];
  /** 建议面试官重点核实/提问的方向。 */
  interviewFocus: string[];
  /** 原始风险信号（来自 overall_evaluation.risks 与核验缺口）。 */
  riskSignals: string[];
}

const LEAD_ROLES: AuthorRole[] = [
  "first_author",
  "co_first_author",
  "corresponding_author",
  "co_corresponding_author",
  "single_author",
];

const COLLAB_ROLES: AuthorRole[] = [
  "middle_author",
  "co_first_author",
  "co_corresponding_author",
];

function clamp100(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

function levelOf(score: number): PersonaLevel {
  if (score >= 90) return "Exceptional";
  if (score >= 75) return "Outstanding";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Developing";
  return "Emerging";
}

/** 取 LLM 模块分并换算到 0–100；缺失或非法时返回 null。 */
function llm100(
  llm: LlmAssessment | null | undefined,
  moduleKey: string,
): number | null {
  const raw = llm?.modules?.[moduleKey]?.score;
  if (typeof raw !== "number" || Number.isNaN(raw)) return null;
  return clamp100(Math.min(10, Math.max(0, raw)) * 10);
}

/** 硬数据分与 LLM 分加权融合；无 LLM 时直接采用硬数据分。 */
function blend(hard: number, llm: number | null, llmWeight = 0.4): number {
  const h = clamp100(hard);
  if (llm === null) return h;
  return clamp100(h * (1 - llmWeight) + llm * llmWeight);
}

function makeDimension(
  key: PersonaDimensionKey,
  label: string,
  score: number,
  basis: string[],
): PersonaDimension {
  return { key, label, score: clamp100(score), level: levelOf(score), basis };
}

/** 统计候选人全部证据的状态分布（原始状态，不含人工 correction）。 */
function evidenceStatusCounts(candidate: Candidate) {
  const all: Evidence[] = [
    ...candidate.basic_info.evidence,
    ...candidate.basic_info.to_verify.flatMap((v) => v.evidence),
    ...candidate.education_employment.education.flatMap((x) => x.evidence),
    ...candidate.education_employment.employment.flatMap((x) => x.evidence),
    ...candidate.awards_funding.awards.flatMap((x) => x.evidence),
    ...candidate.awards_funding.funding.flatMap((x) => x.evidence),
    ...candidate.publications_impact.publications.flatMap((x) => x.evidence),
    ...candidate.academic_service.services.flatMap((x) => x.evidence),
    ...candidate.overall_evaluation.dimensions.flatMap((x) => x.evidence),
  ];
  return {
    total: all.length,
    conflict: all.filter((e) => e.evidence_status === "conflict").length,
    notFound: all.filter((e) => e.evidence_status === "not_found_public").length,
    toVerify: all.filter((e) => e.evidence_status === "to_verify").length,
  };
}

type PositiveKey = Exclude<PersonaDimensionKey, "risk_control">;

const LOW_SCORE_FOCUS: Record<PositiveKey, string> = {
  academic_influence:
    "Ask which publication best represents their scholarly influence and how impact is measured",
  research_output:
    "Discuss their hands-on contribution on each co-authored paper",
  funding_awards:
    "Explore their concrete role and measurable outcomes on funded projects",
  service_collaboration:
    "Ask how reviewing or committee work feeds back into their research",
  career_trajectory:
    "Walk through the rationale and outcomes behind each career move",
};

/**
 * 推导候选人六维画像。
 * @param nowYear 仅用于测试注入「最近 5 年」窗口，默认取当前年份。
 */
export function derivePersona(
  candidate: Candidate,
  llm: LlmAssessment | null | undefined,
  nowYear: number = new Date().getFullYear(),
): Persona {
  const pubs = candidate.publications_impact.publications;
  const funding = candidate.awards_funding.funding;
  const awards = candidate.awards_funding.awards;
  const services = candidate.academic_service.services;
  const edu = candidate.education_employment.education;
  const emp = candidate.education_employment.employment;
  const risks = candidate.overall_evaluation.risks ?? [];
  const pendingClaims = candidate.basic_info.to_verify ?? [];

  // —— 1. 学术影响力：引用 + 分级期刊/会议 + 代码星标 + LLM 评分 ——
  const citations = candidate.publications_impact.total_citations ?? 0;
  const rankedVenues = pubs.filter((p) => Boolean(p.ranking)).length;
  const stars = pubs.reduce((n, p) => n + (p.repository_stars ?? 0), 0);
  const influenceHard =
    Math.min(citations / 300, 1) * 45 +
    (pubs.length ? Math.min(rankedVenues / pubs.length, 1) * 25 : 0) +
    Math.min(stars / 500, 1) * 15 +
    Math.min(pubs.length / 12, 1) * 15;
  const influence = makeDimension(
    "academic_influence",
    "Academic Influence",
    blend(influenceHard, llm100(llm, "publications_impact"), 0.45),
    [
      citations > 0
        ? `${citations} total citations across ${pubs.length} publication(s)`
        : "No citation data available in the submitted materials",
      rankedVenues > 0
        ? `${rankedVenues} paper(s) published in ranked venues`
        : "No ranked-venue label detected",
      stars > 0 ? `${stars} repository stars on released code` : null,
    ].filter((x): x is string => Boolean(x)),
  );

  // —— 2. 科研产出：数量 + 主导作者占比 + 近五年活跃度 ——
  const leadPubs = pubs.filter((p) => LEAD_ROLES.includes(p.author_role));
  const recentPubs = pubs.filter((p) => p.year !== null && p.year >= nowYear - 5);
  const leadRatio = pubs.length ? leadPubs.length / pubs.length : 0;
  const outputHard =
    Math.min(pubs.length / 15, 1) * 55 +
    leadRatio * 30 +
    Math.min(recentPubs.length / 5, 1) * 15;
  const output = makeDimension(
    "research_output",
    "Research Output",
    blend(outputHard, llm100(llm, "publications_impact"), 0.35),
    [
      `${pubs.length} publication(s) on record`,
      pubs.length
        ? `${leadPubs.length} as first, co-first or corresponding author`
        : "No authorship records",
      `${recentPubs.length} paper(s) published in the last five years`,
    ],
  );

  // —— 3. 基金与获奖：PI 项目 + 奖项数量 + 经费披露 ——
  const piProjects = funding.filter(
    (f) => f.role === "PI" || f.role === "Co-PI",
  ).length;
  const amountDisclosed = funding.some((f) => f.amount !== null);
  const fundingHard =
    Math.min(piProjects / 3, 1) * 45 +
    Math.min(awards.length / 5, 1) * 40 +
    (amountDisclosed ? 15 : funding.length ? 8 : 0);
  const fundingDim = makeDimension(
    "funding_awards",
    "Funding & Awards",
    blend(fundingHard, llm100(llm, "awards_funding"), 0.4),
    [
      `${piProjects} project(s) led as PI or Co-PI out of ${funding.length} funding record(s)`,
      `${awards.length} award(s) documented`,
      amountDisclosed
        ? "Grant amounts are disclosed in the materials"
        : "No grant amount disclosed",
    ],
  );

  // —— 4. 学术服务与合作：服务记录 + 类型多样性 + 合作作者占比 ——
  const serviceTypes = new Set(services.map((s) => s.service_type)).size;
  const collabPubs = pubs.filter((p) => COLLAB_ROLES.includes(p.author_role));
  const hasEditorRole = services.some((s) => s.service_type === "editor");
  const serviceHard =
    Math.min(services.length / 8, 1) * 45 +
    Math.min(serviceTypes / 3, 1) * 25 +
    (pubs.length ? Math.min(collabPubs.length / pubs.length, 1) * 20 : 0) +
    (hasEditorRole ? 10 : 0);
  const serviceDim = makeDimension(
    "service_collaboration",
    "Service & Collaboration",
    blend(serviceHard, llm100(llm, "academic_service"), 0.4),
    [
      `${services.length} academic service record(s) across ${serviceTypes} role type(s)`,
      pubs.length
        ? `${collabPubs.length} collaborative (non-lead) authorship record(s)`
        : "No co-authorship data",
      hasEditorRole ? "Holds an editorial role" : "No editorial role found",
    ],
  );

  // —— 5. 成长轨迹：学历层次 + 机构跨度 + 任职与成果 ——
  const hasDoctorate = edu.some((e) =>
    /ph\.?d|doctor/i.test(e.degree ?? ""),
  );
  const institutions = new Set(
    [...edu.map((e) => e.institution), ...emp.map((e) => e.institution)].filter(
      (x): x is string => Boolean(x),
    ),
  ).size;
  const outcomes =
    edu.reduce((n, e) => n + e.outcomes.length, 0) +
    emp.reduce((n, e) => n + e.outcomes.length, 0);
  const trajectoryHard =
    (hasDoctorate ? 30 : edu.length ? 18 : 0) +
    Math.min(institutions / 4, 1) * 35 +
    Math.min(emp.length / 3, 1) * 20 +
    Math.min(outcomes / 8, 1) * 15;
  const trajectory = makeDimension(
    "career_trajectory",
    "Career Trajectory",
    blend(trajectoryHard, llm100(llm, "education_employment"), 0.4),
    [
      hasDoctorate
        ? "Doctoral degree documented"
        : edu.length
          ? `${edu.length} education record(s), no doctorate detected`
          : "No education records",
      `${institutions} distinct institution(s) across education and employment`,
      `${emp.length} employment record(s) with ${outcomes} documented outcome(s)`,
    ],
  );

  // —— 6. 风险控制：风险条目 + 核验缺口 + 证据冲突（分越高越干净）——
  const counts = evidenceStatusCounts(candidate);
  const riskHard =
    100 -
    risks.length * 12 -
    counts.toVerify * 6 -
    counts.notFound * 8 -
    counts.conflict * 15;
  const riskBasis: string[] = [];
  if (risks.length === 0) {
    riskBasis.push("No explicit risk signal in the overall evaluation");
  } else {
    riskBasis.push(...risks.slice(0, 3));
  }
  if (counts.toVerify > 0)
    riskBasis.push(`${counts.toVerify} evidence item(s) pending verification`);
  if (counts.notFound > 0)
    riskBasis.push(`${counts.notFound} source(s) not found publicly`);
  if (counts.conflict > 0)
    riskBasis.push(`${counts.conflict} conflicting evidence item(s)`);
  const riskControl = makeDimension(
    "risk_control",
    "Risk Control",
    riskHard,
    riskBasis,
  );

  const dimensions = [
    influence,
    output,
    fundingDim,
    serviceDim,
    trajectory,
    riskControl,
  ];

  // —— 人物标签：按确定性优先级取最多 4 个 ——
  const tags: string[] = [];
  const pushTag = (tag: string) => {
    if (tags.length < 4 && !tags.includes(tag)) tags.push(tag);
  };
  if (influence.score >= 78) pushTag("High-impact researcher");
  if (output.score >= 72 && leadRatio >= 0.5) pushTag("Lead-author publisher");
  if (piProjects >= 2) pushTag("Grant-winning PI");
  else if (piProjects === 1) pushTag("Principal investigator");
  if (services.length >= 5) pushTag("Active academic citizen");
  if (stars >= 100) pushTag("Open-source builder");
  if (hasDoctorate && institutions >= 3) pushTag("Cross-institution path");
  if (recentPubs.length >= 3) pushTag("Currently active");
  if (riskControl.score < 45) pushTag("Verification gaps to probe");
  if (tags.length === 0) {
    pushTag(pubs.length >= 3 ? "Documented researcher" : "Emerging profile");
  }

  // —— 一句话概述：取两个最强维度（风险控制不参与正向概述）——
  const positive = dimensions
    .filter((d) => d.key !== "risk_control")
    .sort((a, b) => b.score - a.score);
  const phrase: Record<Exclude<PersonaDimensionKey, "risk_control">, string> = {
    academic_influence: "strong scholarly influence",
    research_output: "a prolific research output",
    funding_awards: "a solid grant and award record",
    service_collaboration: "deep engagement in academic service",
    career_trajectory: "a well-structured career trajectory",
  };
  const headline =
    positive[0].score < 40
      ? "An emerging research profile with clear room to grow."
      : `A profile defined by ${phrase[positive[0].key as PositiveKey]}${
          positive[1] && positive[1].score >= 60
            ? `, backed by ${phrase[positive[1].key as PositiveKey]}`
            : ""
        }.`;

  // —— 面试关注点：风险条目 + 最弱两维 + 待核实声明，最多 4 条 ——
  const focus: string[] = [];
  risks.slice(0, 2).forEach((r) => focus.push(`Probe the documented risk: ${r}`));
  const weakest = [...positive].sort((a, b) => a.score - b.score).slice(0, 2);
  weakest
    .filter((d) => d.score < 60)
    .forEach((d) => focus.push(LOW_SCORE_FOCUS[d.key as PositiveKey]));
  if (pendingClaims[0]) {
    focus.push(
      `Verify the self-reported claim: ${pendingClaims[0].claim.slice(0, 140)}`,
    );
  }
  if (focus.length === 0) {
    focus.push(
      "Ask the candidate to walk through the contribution of their most-cited work",
    );
  }
  const interviewFocus = focus.slice(0, 4);

  // —— 原始风险信号透传，供卡片单独展示 ——
  const riskSignals =
    risks.length > 0
      ? risks.slice(0, 4)
      : counts.toVerify > 0
        ? [`${counts.toVerify} self-reported item(s) still await public verification.`]
        : ["No explicit risk signal found in the submitted materials."];

  return { headline, dimensions, tags, interviewFocus, riskSignals };
}
