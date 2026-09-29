# AIE1903: Candidate Document Intelligence

AIE1903 Project 1 turns candidate application documents into a structured,
searchable, and evidence-grounded profile for an AI-assisted faculty hiring
workflow.

The system accepts PDF and DOCX documents, extracts information into a strict
JSON contract, verifies selected claims against public sources, and presents
the result through a web interface with evidence links and manual correction.

## Project Status

The backend implementation is currently tracked on `feature/backend-init`
(PR #7), and the final frontend `getProfile` type correction is on
`feature/frontend-init`. Merge those changes into `main` before running the
full-stack workflow from the default branch.

## Core Features

- Upload one to four PDF or DOCX documents per analysis.
- Extract text with page numbers from PDF files.
- Extract paragraphs and table content from DOCX files.
- Use OCR as a fallback for scanned or image-only PDF pages.
- Extract a six-module candidate profile with DeepSeek.
- Require provenance for every factual claim.
- Verify publications with Crossref and OpenAlex.
- Optionally search public web results for awards, funding, positions, and
  institutions.
- Display evidence status, source links, supporting text, page numbers, and
  query dates.
- Support keyword and tag filtering in the profile view.
- Support in-session manual correction of evidence status.
- Validate profiles against the JSON Schema contract.

## Architecture

```text
PDF / DOCX uploads
        |
        v
Document parser and OCR fallback
        |
        v
DeepSeek structured extraction
        |
        v
Public-source verification
  - Crossref / OpenAlex for publications
  - optional web search for other claims
        |
        v
JSON Schema validation
        |
        v
FastAPI endpoints
        |
        v
Next.js candidate profile interface
```

## Repository Layout

```text
app/                         FastAPI backend and analysis pipeline
frontend/                    Next.js and TypeScript web interface
docs/schema.json             Authoritative candidate profile contract
docs/api.md                  Backend API contract
tests/                       Backend unit and contract tests
outputs/                     Example extracted and verified profiles
.env.example                 Environment variable template
requirements.txt             Pinned backend dependencies
```

## Prerequisites

- Python 3.12 or later
- Node.js 20 or later and npm
- A DeepSeek API key for structured extraction
- Network access for public-source verification
- Optional OCR tools:
  - Tesseract OCR with the required language packs
  - Poppler utilities for PDF page rendering

## Backend Setup

Create and activate a virtual environment:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

macOS or Linux:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set the DeepSeek API key in `.env`:

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

Start the backend:

```bash
uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

Interactive API documentation is available at:

```text
http://localhost:8000/docs
```

## Frontend Setup

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`.

The frontend uses `http://localhost:8000` by default. Override it with:

Windows PowerShell:

```powershell
$env:NEXT_PUBLIC_API_BASE = "http://localhost:8000"
npm run dev
```

macOS or Linux:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

The checked-in profile page currently uses synthetic data from
`frontend/lib/mock.ts`. During full-stack integration, replace that source with
the API client functions in `frontend/lib/api.ts`.

## API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service health check |
| `POST` | `/api/upload` | Upload one to four PDF or DOCX files |
| `POST` | `/api/analyze` | Parse, extract, and verify an uploaded document set |
| `GET` | `/api/profile` | Return a stored profile by `profile_id` or `upload_id` |

`POST /api/qa` is documented as an optional Q&A extension, but it is not
implemented in the current backend.

### Upload

```bash
curl -X POST http://localhost:8000/api/upload \
  -F "files=@candidate_cv.pdf" \
  -F "files=@research_statement.pdf"
```

### Analyze

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"upload_id":"upl_example"}'
```

### Retrieve a Profile

```bash
curl "http://localhost:8000/api/profile?profile_id=prf_example"
```

`/api/analyze` returns:

```json
{
  "profile_id": "prf_example",
  "status": "completed",
  "schema_version": "1.0.0",
  "candidate": {}
}
```

`/api/profile` returns a directly schema-valid profile:

```json
{
  "schema_version": "1.0.0",
  "candidate": {}
}
```

## Data Contract

`docs/schema.json` is the source of truth for structured output.

Each candidate profile contains six modules:

1. `basic_info`
2. `education_employment`
3. `awards_funding`
4. `publications_impact`
5. `academic_service`
6. `overall_evaluation`

Every evidence object contains:

| Field | Meaning |
|---|---|
| `source` | File name, institution, publisher, database, or search source |
| `source_url` | Openable provenance URL or `null` |
| `evidence` | Supporting quotation or search-result summary |
| `evidence_status` | `confirmed`, `not_found_public`, `to_verify`, or `conflict` |
| `query_date` | Date on which the source was read or queried |
| `page` | Optional source page number |
| `source_type` | Optional source category |
| `notes` | Optional reviewer note |

Unknown values must be represented as `null` or an empty array. Missing public
evidence does not prove that a claim is false.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API authentication |
| `DEEPSEEK_MODEL` | No | Model name, default `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | No | DeepSeek-compatible API base URL |
| `OCR_LANGUAGES` | No | Tesseract languages, default `chi_sim+eng` |
| `OCR_DPI` | No | OCR rendering resolution, default `300` |
| `TESSERACT_CMD` | No | Path to the Tesseract executable |
| `WEB_SEARCH_PROVIDER` | No | Web search provider, currently `bing` |
| `WEB_SEARCH_BASE_URL` | No | Search endpoint override |
| `NEXT_PUBLIC_API_BASE` | No | Frontend API base URL |

## Testing

Run backend tests:

```bash
python -m unittest discover -v
```

Run frontend checks:

```bash
cd frontend
npm run lint
npm run build
```

OCR tests require a usable system font plus Tesseract and Poppler. Make those
tools available before running OCR-specific tests.

## Privacy and Responsible AI

- Never commit real candidate documents, private contact data, API keys, or
  `.env` files.
- Keep private candidate material in an ignored local directory.
- Preserve source, evidence text, status, and query date for every claim.
- Do not silently overwrite conflicting evidence.
- Treat `not_found_public` as incomplete verification, not as proof of fraud.
- Keep model-generated assessment separate from source-backed facts.

## Current Limitations

- Profiles and uploads are stored in process memory and local cache files, not
  in a production database.
- `/api/analyze` is synchronous and may take time when external verification
  is enabled.
- `/api/qa` is specified but not implemented.
- The frontend still uses mock data on the profile page and needs full API
  integration.
- Browser calls from the Next.js origin to the FastAPI origin require CORS
  middleware or a development proxy.
- OCR depends on external Tesseract and Poppler installations.

## Collaboration

1. Create a branch for each task:

   ```bash
   git switch -c feature/task-name
   ```

2. Commit and push the branch.
3. Open a pull request before merging into `main`.
4. Review the data contract, privacy risks, tests, and merge conflicts before
   approval.

