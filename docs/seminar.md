# Project 3 — candidate seminar review

## What this adds

A separate `/seminar` workflow links to the existing candidate profile. It can
represent a research talk or teaching demonstration; confirm the precise course
interpretation with the instructor. Existing interview questions and reports are
unchanged. The new sidebar entry and candidate's **Review seminar** button open it.

## Setup

Use the normal README setup (Python 3.12+, Node 20+). No new production packages
are required: PyAV/Pillow and the OpenAI client already exist in requirements.
Set `SEMINAR_VISION_MODEL` to a provider model that actually accepts images.
For the official DeepSeek image-capable endpoint, use a supported vision model
such as `deepseek-flash` if available on your account; verify against your
provider's current model list, especially if using a third-party relay.

Optional `SEMINAR_VISION_BASE_URL` and `SEMINAR_VISION_API_KEY` fall back to the
existing DeepSeek settings when blank. Keys remain backend-only. Do not change
the P1/P2 `DEEPSEEK_MODEL` merely to configure Project 3. Missing configuration
is rejected before a scan is queued. This integration was tested with a mocked
provider, not live account credentials.

## Walkthrough

1. Generate a candidate profile; click **Review seminar**. Create a titled session.
2. Upload speaker and shared-screen recordings of the same event. Each uses
   4 MiB chunks and the existing video size/duration limits (500 MiB / 20 minutes
   by default; `INTERVIEW_MAX_VIDEO_BYTES`, `INTERVIEW_MAX_VIDEO_SECONDS`).
   A screen recording without audio is allowed. Use MP4 H.264/AAC for broad
   browser playback; other containers can decode server-side but fail in a browser.
3. Adjust offset. **screen_time = speaker_time + offset**. If speaker 00:10 matches
   screen 00:13, enter +3. Check beginning, middle and end, then confirm alignment.
   Only the overlapping interval is played/scanned. Replacing media or changing
   confirmed alignment invalidates prior observations. Reconfirming the same
   offset preserves them.
4. Pick up to **120 seconds** in speaker time and a transcript source. Start a
   scan. Images go to the configured model and may incur charges. Each request
   contains at most one eight-second window (roughly 8 speaker + 2 screen frames,
   more screen frames when the screen changes). Scan later ranges as needed.
5. Review the three dimensions. Click **View evidence** to position both videos
   and see saved frame sequences. Mark Confirmed, Inaccurate or Cannot determine.
   Refresh and select the saved seminar to resume; reviews are saved server-side.

## Evidence and failure rules

- Whisper runs locally on the selected original recording; only transcript
  segments overlapping the scan range are supplied to the model. Screen transcript
  timestamps are shifted back to speaker time. Missing audio/ASR failure produces
  a warning and visual scanning continues. Choose visual-only to skip ASR.
- PyAV samples approximately 1 fps using media presentation timestamps. Black
  images are skipped. Repeated screen frames are reduced, but periodic anchors
  and speaker sequences are retained. Static posture is not discarded simply
  because there is no motion. One-second sampling can miss very brief gestures.
- The model receives JPEG content, view labels, canonical timestamps, and optional
  transcript context. It returns observations and frame IDs. The backend rejects
  invented IDs, malformed dimensions, and claims with fewer than two speaker
  evidence frames; event times are derived from evidence, not model timestamps.
- Fact and interpretation are displayed separately. No emotional, personality,
  competency, or hiring verdict is requested. Image evidence can still be
  misinterpreted; human review remains necessary.
- Failed model batches retain frames and report warnings. A failed retry preserves
  existing reviewed observations. Successful contiguous batches replace observations wholly
  contained in their combined coverage, including events across batch boundaries.
  A failed gap preserves prior observations crossing that gap. Scans are sequential within each job, with at most two active jobs.
- Persistent metadata uses atomic JSON files in `.cache/seminars` (or
  `SEMINAR_DATA_DIR`), with local videos/frame JPEGs. Restarted incomplete jobs
  become failed/retryable. Use one backend process for this course demo.
- This inherits the demo application's lack of production authentication. Use
  consented/demo recordings. No production access-control system is added here.

## API

| Method | Path under `/api/seminars` | Purpose |
|---|---|---|
| POST / GET | `/` (without trailing slash) | Create / list sessions |
| GET | `/{id}` | Full session, progress and report |
| POST | `/{id}/videos/{speaker\|screen}/init` | Begin upload (`filename`, `total_bytes`) |
| PUT | `/{id}/videos/{view}/uploads/{upload_id}/chunks/{index}` | Exact-size binary chunk |
| POST | `/{id}/videos/{view}/uploads/{upload_id}/complete` | Merge/probe video |
| POST | `/{id}/alignment` | Confirm signed `offset_ms` |
| POST | `/{id}/scan` | `start_ms`, `end_ms`, `audio_view` (`speaker`, `screen`, `none`) |
| PATCH | `/{id}/observations/{observation_id}` | Set `review_status` |
| GET | `/{id}/videos/{view}` | Range-capable media playback |
| GET | `/{id}/frames/{frame_id}` | Saved evidence JPEG |

## Verification

- `python -m unittest tests.test_seminar -v`: real synthetic silent video decoding,
  chunk validation, both offset signs, nonexistent evidence, timestamp grounding,
  provider image payload, missing audio, failure preservation and review persistence.
- `python -m unittest discover -q`: full regression suite. Existing scanned-PDF
  test also requires Poppler (`pdfinfo`/`pdftoppm`), Tesseract and fonts.
- `cd frontend && npm run test:seminar`: timing boundaries and real React player
  behavior under delayed metadata (Node 22.6+ for this test runner).
- `cd frontend && npm run lint && npm run build`.
- Manual real-media acceptance: align +3 and -3 second pairs, scrub, play/pause,
  test buffering/end-of-overlap, open an observation and verify both views show
  the same action. Test with a real configured vision provider before course demo.

### Validation in this implementation session

11 seminar backend tests and 6 frontend tests pass. The production build passes;
lint reports no errors and four pre-existing image warnings. The full backend
suite passes 154/155 tests; `test_parse_pdf_falls_back_to_ocr_for_scanned_page`
fails because this machine lacks Poppler (`pdfinfo`/`pdftoppm`). Existing OCR
implementation was not modified. Browser checks with labeled synthetic H.264
videos confirmed evidence seek, paired playback and stopping at the shared end.
No real candidate footage or live paid vision API call was used.
