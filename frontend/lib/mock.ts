import type { CandidateProfile } from "./types";

// 用于前端开发的模拟候选人档案（脱敏示例，字段与 schema.json 对齐）。
// 后端联调时由 lib/api.ts 的真实数据替换。
export const mockProfile: CandidateProfile = {
  schema_version: "1.0.0",
  candidate: {
    basic_info: {
      name: "张三",
      institution: "某某大学",
      position: "副教授",
      research_interests: ["机器学习", "计算机视觉"],
      highest_degree: "计算机科学博士",
      skills: ["Python", "PyTorch", "TensorFlow", "Linux"],
      strengths: ["论文产出稳定", "具备独立主持项目能力"],
      to_verify: [
        {
          claim: "博士毕业年份",
          reason: "简历与学校官网不一致",
          evidence: [
            {
              source: "institutional page",
              source_url: "https://example.edu/profile",
              evidence: "官网显示 2020 年毕业，简历写 2021 年。",
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
          evidence: "简历首页列出姓名、机构与职位。",
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
          degree: "博士",
          field: "计算机科学",
          institution: "某某大学",
          advisor: "李教授",
          start_date: "2016-09",
          end_date: "2020-06",
          projects: ["深度学习可解释性研究"],
          outcomes: ["发表 CCF A 论文 3 篇"],
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "简历教育经历部分。",
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
          institution: "某某大学",
          position: "副教授",
          start_date: "2021-01",
          end_date: null,
          responsibilities: ["讲授计算机视觉课程", "指导研究生"],
          projects: ["多模态视觉理解"],
          outcomes: ["主持国家自然科学基金项目"],
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "简历工作经历部分。",
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
          name: "优秀青年学者奖",
          year: 2023,
          awarding_body: "某某学会",
          evidence: [
            {
              source: "某某学会官网",
              source_url: "https://example.org/award",
              evidence: "获奖名单页面。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "institutional_page",
            },
          ],
        },
      ],
      funding: [
        {
          project_name: "多模态视觉理解",
          funder: "国家自然科学基金",
          start_date: "2024-01",
          end_date: "2026-12",
          amount: 500000,
          currency: "CNY",
          role: "PI",
          evidence: [
            {
              source: "基金系统",
              source_url: "https://example.org/grants/1",
              evidence: "项目立项页面显示负责人为候选人。",
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
              evidence: "论文页面列出候选人为第一作者。",
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
              evidence: "论文页面列出候选人为通讯作者。",
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
          research_areas: ["计算机视觉"],
          evidence: [
            {
              source: "CVPR 官网",
              source_url: "https://cvpr.example.org/pc",
              evidence: "程序委员会名单包含候选人。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
      ],
    },
    overall_evaluation: {
      summary: "候选人在计算机视觉方向有稳定的论文产出和独立主持项目的能力。",
      strengths: ["论文影响力较高", "独立主持项目"],
      risks: ["博士毕业年份需进一步核实"],
      dimensions: [
        {
          dimension: "Research Capability & Potential",
          assessment: "有多篇 CCF A 论文，研究能力较强。",
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/123456",
              evidence: "论文及引用数据。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
        {
          dimension: "Teaching Capability",
          assessment: "讲授核心课程并指导研究生，教学能力有支撑。",
          evidence: [
            {
              source: "candidate_cv.pdf",
              source_url: null,
              evidence: "简历工作经历中列出的教学任务。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "resume",
            },
          ],
        },
        {
          dimension: "Position and Departmental Fit",
          assessment: "研究方向与目标院系匹配度较高。",
          evidence: [
            {
              source: "research_statement.pdf",
              source_url: null,
              evidence: "研究陈述中说明的研究方向。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "supporting_document",
            },
          ],
        },
        {
          dimension: "Scholarly Impact & Professional Standing",
          assessment: "论文影响力较高，总引用量可观。",
          evidence: [
            {
              source: "IEEE Xplore",
              source_url: "https://ieeexplore.ieee.org/document/123456",
              evidence: "引用数据页面。",
              evidence_status: "confirmed",
              query_date: "2026-09-28",
              source_type: "publisher_page",
            },
          ],
        },
        {
          dimension: "Contribution to the Academic Community",
          assessment: "担任 CVPR 程序委员会成员，参与学术服务。",
          evidence: [
            {
              source: "CVPR 官网",
              source_url: "https://cvpr.example.org/pc",
              evidence: "程序委员会名单。",
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
