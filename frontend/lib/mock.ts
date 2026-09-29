import type { CandidateProfile } from "./types";

// 用于前端开发的模拟候选人档案（脱敏示例，字段与 schema.json 对齐）。
// 后端联调时由 lib/api.ts 的真实数据替换。
export const mockProfile: CandidateProfile = {
  schema_version: "1.0.0",
  candidate: {
    basic_info: {
      name: "Jane Doe",
      institution: "Example University",
      position: "Associate Professor",
      research_interests: ["Machine Learning", "Computer Vision"],
      highest_degree: "Ph.D. in Computer Science",
      skills: ["Python", "PyTorch", "TensorFlow", "Linux"],
      strengths: ["Consistent publication output", "Ability to lead independent projects"],
      to_verify: [
        {
          claim: "Ph.D. graduation year",
          reason: "The CV and the university website disagree.",
          evidence: [
            {
              source: "institutional page",
              source_url: "https://example.edu/profile",
              evidence: "The website says 2020, while the CV says 2021.",
              evidence_status: "conflict",
              query_date: "2026-09-28",
              source_type: "institutional_page",
            },
          ],
        },
      ],
      evidence: [
        {
          source: "candidate_cv.pdf",
          source_url: null,
          evidence: "The first page lists the name, institution, and position.",
          evidence_status: "confirmed",
          query_date: "2026-09-28",
          page: 1,
          source_type: "resume",
        },
      ],
    },
    education_employment: {
      education: [
        {
          degree: "Ph.D.",
          field: "Computer Science",
          institution: "Example University",
          advisor: "Prof. Li",
          start_date: "2016-09",
          end_date: "2020-06",
          projects: ["Deep learning interpretability research"],
          outcomes: ["Published three CCF-A papers"],
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "Education section of the CV.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              page: 2,
              source_type: "resume",
            },
          ],
        },
      ],
      employment: [
        {
          institution: "Example University",
          position: "Associate Professor",
          start_date: "2021-01",
          end_date: null,
          responsibilities: ["Teach computer vision courses", "Supervise graduate students"],
          projects: ["Multimodal visual understanding"],
          outcomes: ["Lead a national research foundation project"],
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "Work experience section of the CV.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              page: 3,
              source_type: "resume",
            },
          ],
        },
      ],
    },
    awards_funding: {
      awards: [
        {
          name: "Outstanding Young Scholar Award",
          year: 2023,
          awarding_body: "Example Society",
          evidence: [
            {
              source: "Example Society website",
              source_url: "https://example.org/award",
              evidence: "Award recipients page.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "institutional_page",
            },
          ],
        },
      ],
      funding: [
        {
          project_name: "Multimodal Visual Understanding",
          funder: "National Natural Science Foundation",
          start_date: "2024-01",
          end_date: "2026-12",
          amount: 500000,
          currency: "CNY",
          role: "PI",
          evidence: [
            {
              source: "Funding system",
              source_url: "https://example.org/grants/1",
              evidence: "The project page lists the candidate as the lead investigator.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "institutional_page",
            },
          ],
        },
      ],
    },
    publications_impact: {
      publications: [
        {
          title: "An Example Paper on Vision",
          year: 2023,
          author_role: "first_author",
          venue: "CVPR",
          venue_type: "conference",
          ranking: "CCF A",
          citation_count: 120,
          citation_query_date: "2026-09-28",
          code_repository: "https://github.com/example/paper",
          repository_stars: 350,
          stars_query_date: "2026-09-28",
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/123456",
              evidence: "The paper page lists the candidate as first author.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
        {
          title: "Another Paper on Model Compression",
          year: 2024,
          author_role: "corresponding_author",
          venue: "IEEE TPAMI",
          venue_type: "journal",
          ranking: "CCF A",
          citation_count: 45,
          citation_query_date: "2026-09-28",
          code_repository: null,
          repository_stars: null,
          stars_query_date: null,
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/654321",
              evidence: "The paper page lists the candidate as corresponding author.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
      ],
      total_citations: 1200,
      citation_query_date: "2026-09-28",
    },
    academic_service: {
      services: [
        {
          service_type: "program_committee",
          organization_or_venue: "CVPR",
          role: "Program Committee Member",
          start_year: 2024,
          end_year: 2026,
          research_areas: ["Computer Vision"],
          evidence: [
            {
              source: "CVPR website",
              source_url: "https://cvpr.example.org/pc",
              evidence: "The program committee list includes the candidate.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
      ],
    },
    overall_evaluation: {
      summary: "The candidate has a consistent publication record in computer vision and can lead independent projects.",
      strengths: ["High publication impact", "Independent project leadership"],
      risks: ["The Ph.D. graduation year needs further verification"],
      dimensions: [
        {
          dimension: "Research Capability & Potential",
          assessment: "Several CCF-A publications indicate strong research capability.",
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/123456",
              evidence: "Publication and citation data.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
        {
          dimension: "Teaching Capability",
          assessment: "Teaching core courses and supervising graduate students support teaching capability.",
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "Teaching duties listed in the work experience section.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "resume",
            },
          ],
        },
        {
          dimension: "Position and Departmental Fit",
          assessment: "The research direction aligns closely with the target department.",
          evidence: [
            {
              source: "research_statement.pdf",
              source_url: null,
              evidence: "Research direction described in the research statement.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "supporting_document",
            },
          ],
        },
        {
          dimension: "Scholarly Impact & Professional Standing",
          assessment: "Publication impact is high and total citations are substantial.",
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/123456",
              evidence: "Citation data page.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
        {
          dimension: "Contribution to the Academic Community",
          assessment: "Served on the CVPR program committee and contributed to academic service.",
          evidence: [
            {
              source: "CVPR website",
              source_url: "https://cvpr.example.org/pc",
              evidence: "Program committee list.",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
      ],
    },
  },
};
