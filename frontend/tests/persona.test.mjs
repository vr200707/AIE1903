import test from "node:test";
import assert from "node:assert/strict";
import { derivePersona } from "../lib/persona.ts";

const evidence = (status = "confirmed") => ({
  source: "Example University",
  source_url: "https://example.org/p",
  evidence: "Public profile page",
  evidence_status: status,
  query_date: "2026-01-01",
  source_type: "institutional_page",
});

function emptyCandidate() {
  return {
    basic_info: {
      name: "Test Candidate",
      institution: null,
      position: null,
      research_interests: [],
      highest_degree: null,
      skills: [],
      strengths: [],
      to_verify: [],
      evidence: [],
    },
    education_employment: { education: [], employment: [] },
    awards_funding: { awards: [], funding: [] },
    publications_impact: {
      publications: [],
      total_citations: null,
      citation_query_date: null,
    },
    academic_service: { services: [] },
    overall_evaluation: {
      summary: null,
      strengths: [],
      risks: [],
      dimensions: [],
    },
  };
}

function richCandidate() {
  const c = emptyCandidate();
  c.basic_info.highest_degree = "PhD";
  c.education_employment.education = [
    {
      degree: "PhD",
      field: "Computer Science",
      institution: "Alpha University",
      advisor: "Prof. A",
      start_date: "2012",
      end_date: "2016",
      projects: ["vision"],
      outcomes: ["3 papers", "best paper"],
      evidence: [evidence()],
    },
    {
      degree: "MSc",
      field: "Computer Science",
      institution: "Beta Institute",
      advisor: null,
      start_date: "2010",
      end_date: "2012",
      projects: [],
      outcomes: ["thesis prize"],
      evidence: [evidence()],
    },
  ];
  c.education_employment.employment = [
    {
      institution: "Gamma Lab",
      position: "Postdoc",
      start_date: "2016",
      end_date: "2019",
      responsibilities: [],
      projects: ["grasping"],
      outcomes: ["dataset release", "2 grants"],
      evidence: [evidence()],
    },
    {
      institution: "Delta University",
      position: "Associate Professor",
      start_date: "2019",
      end_date: null,
      responsibilities: [],
      projects: ["multimodal"],
      outcomes: ["center lead"],
      evidence: [evidence()],
    },
    {
      institution: "Epsilon Research",
      position: "Visiting Scholar",
      start_date: "2022",
      end_date: "2023",
      responsibilities: [],
      projects: [],
      outcomes: ["joint paper"],
      evidence: [evidence()],
    },
  ];
  c.awards_funding.awards = [1, 2, 3, 4, 5].map((i) => ({
    name: `Award ${i}`,
    year: 2020 + i,
    awarding_body: "Society",
    evidence: [evidence()],
  }));
  c.awards_funding.funding = [
    { role: "PI", amount: 500000, currency: "CNY" },
    { role: "PI", amount: 300000, currency: "CNY" },
    { role: "participant", amount: null, currency: null },
  ].map((f) => ({
    project_name: "Project",
    funder: "NSFC",
    start_date: "2020",
    end_date: "2024",
    ...f,
    evidence: [evidence()],
  }));
  const leadRoles = [
    "first_author",
    "corresponding_author",
    "co_first_author",
    "single_author",
  ];
  c.publications_impact.publications = Array.from({ length: 12 }, (_, i) => ({
    title: `Paper ${i + 1}`,
    year: 2022 + (i % 5),
    author_role: i < 8 ? leadRoles[i % leadRoles.length] : "middle_author",
    venue: "Venue",
    venue_type: "journal",
    ranking: i < 3 ? "Q1" : null,
    citation_count: null,
    citation_query_date: null,
    code_repository: i === 0 ? "https://github.com/example/repo" : null,
    repository_stars: i === 0 ? 600 : null,
    stars_query_date: i === 0 ? "2026-01-01" : null,
    evidence: [evidence()],
  }));
  c.publications_impact.total_citations = 400;
  c.publications_impact.citation_query_date = "2026-01-01";
  c.academic_service.services = [
    ...["reviewer", "program_committee", "editor"].map((service_type) => ({
      service_type,
      organization_or_venue: "Top Venue",
      role: null,
      start_year: 2020,
      end_year: null,
      research_areas: ["AI"],
      evidence: [evidence()],
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      service_type: "reviewer",
      organization_or_venue: `Journal ${i}`,
      role: null,
      start_year: 2018 + i,
      end_year: 2019 + i,
      research_areas: [],
      evidence: [evidence()],
    })),
  ];
  return c;
}

test("derivePersona handles an empty candidate without throwing", () => {
  const p = derivePersona(emptyCandidate(), null, 2026);
  assert.equal(p.dimensions.length, 6);
  for (const d of p.dimensions) {
    assert.ok(d.score >= 0 && d.score <= 100, `${d.key} out of range`);
    assert.ok(d.basis.length > 0, `${d.key} needs basis text`);
    assert.ok(["Emerging", "Developing", "Strong", "Outstanding", "Exceptional"].includes(d.level));
  }
  assert.ok(p.tags.length >= 1);
  assert.ok(p.headline.length > 0);
  assert.ok(p.interviewFocus.length >= 1);
  assert.ok(p.riskSignals.length >= 1);
});

test("rich candidate gets high scores and persona tags from hard data", () => {
  const p = derivePersona(richCandidate(), null, 2026);
  const byKey = Object.fromEntries(p.dimensions.map((d) => [d.key, d]));
  assert.ok(byKey.academic_influence.score >= 70, "influence should be high");
  assert.ok(byKey.research_output.score >= 70, "output should be high");
  assert.ok(byKey.funding_awards.score >= 70, "funding should be high");
  assert.ok(byKey.service_collaboration.score >= 70, "service should be high");
  assert.ok(byKey.career_trajectory.score >= 60, "trajectory should be strong");
  assert.ok(byKey.risk_control.score >= 80, "clean materials should score high on risk control");
  assert.ok(p.tags.includes("High-impact researcher"));
  assert.ok(p.tags.includes("Grant-winning PI"));
  // 富样本中成长轨迹（博士+5 机构+3 任职）为最强维度，headline 以它开头
  assert.ok(p.headline.startsWith("A profile defined by"), p.headline);
  assert.ok(p.headline.includes("career trajectory"), p.headline);
});

test("risks and conflicting evidence lower risk control and create focus items", () => {
  const c = richCandidate();
  c.overall_evaluation.risks = ["A claimed award could not be located publicly."];
  c.basic_info.to_verify = [
    { claim: "Visiting scholar appointment at Epsilon", reason: "self-reported", evidence: [evidence("to_verify")] },
    { claim: "Keynote at Workshop X", reason: "self-reported", evidence: [evidence("to_verify")] },
  ];
  c.academic_service.services[0].evidence = [evidence("conflict")];
  const p = derivePersona(c, null, 2026);
  const risk = p.dimensions.find((d) => d.key === "risk_control");
  assert.ok(risk.score < 70, `expected penalized risk score, got ${risk.score}`);
  assert.ok(p.interviewFocus[0].startsWith("Probe the documented risk"));
  assert.ok(p.riskSignals.includes("A claimed award could not be located publicly."));
  assert.ok(p.interviewFocus.some((f) => f.includes("Visiting scholar appointment")));
});

test("LLM module scores blend with hard-data scores", () => {
  const c = richCandidate();
  const withoutLlm = derivePersona(c, null, 2026);
  const withLowLlm = derivePersona(
    c,
    { overall: 5, modules: { publications_impact: { score: 2, pros: "", cons: "" } } },
    2026,
  );
  const a = withoutLlm.dimensions.find((d) => d.key === "academic_influence").score;
  const b = withLowLlm.dimensions.find((d) => d.key === "academic_influence").score;
  assert.ok(b < a, `low LLM score should pull influence down: ${b} vs ${a}`);
});
