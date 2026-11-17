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
   4 MiB chunks and the existing video size limit (500 MiB by default;
   `INTERVIEW_MAX_VIDEO_BYTES`). Seminar recordings have no duration limit.
   A screen recording without audio is allowed. Use MP4 H.264/AAC for broad
   browser playback; other containers can decode server-side but fail in a browser.
3. Adjust offset. **screen_time = speaker_time + offset**. If speaker 00:10 matches
   screen 00:13, enter +3. Check beginning, middle and end, then confirm alignment.
   Only the overlapping interval is played/scanned. Replacing media or changing
   confirmed alignment invalidates prior observations. Reconfirming the same
   offset preserves them.
4. Pick any overlapping range or the full recording in speaker time and a transcript source. Start a
   scan. Images go to the configured model and may incur charges. Each request
   contains at most one eight-second window (roughly 8 speaker + 2 screen frames,
   more screen frames when the screen changes). Long recordings remain split into eight-second batches.
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

## Automatic offset reference

After both uploads finish, the page estimates a reference offset from shared
audio and fills it in only if the match is reliable. **Estimate offset** also
works on saved sessions. The estimate never confirms alignment: the input remains
editable and the reviewer must check playback and press **Confirm alignment**.
Existing confirmed alignment is not changed by requesting a new reference.

The local estimator compares 20 ms audio energy envelopes from the first ten
minutes of each recording, using normalized cross-correlation and a distinct-peak
check. It requires at least 30 seconds of informative overlapping audio. Missing,
silent, unrelated, or ambiguous audio yields a manual-alignment message rather
than a guessed offset. Large start differences beyond the sampled shared content,
clock drift and dissimilar audio tracks may require manual adjustment.

Alignment verification now checks 90-second audio windows near the beginning,
middle and end after the initial estimate. Reliable checkpoint offsets differing
by more than 500 ms withdraw the fixed-offset recommendation. Missing matches
remain explicitly unverified; matching audio never establishes visual alignment.
The expandable visual evidence panel offers independent players for recording the
same visible event in each view. It calculates screen minus speaker timestamps,
flags inconsistent event offsets, and lets the reviewer apply their mean when
consistent. These manual references are temporary to the current page session;
only the separately confirmed offset is persisted. Automatic visual event recognition
is not implemented. Offset notifications dismiss after three seconds.

### Transcript, structure and step navigation

The seminar workflow now has six screens: candidate, videos, alignment, structure,
selected-part scan and review. The session and step are in the URL, so saved work
can be reopened directly. Back/next controls and prerequisite checks replace the
long single-page sequence. Save manual outline edits before scanning; edits stay
in memory while moving between screens, but only saved edits survive refresh.

Structure uses the speaker video's clock. Introduction, Body, Conclusion and
Other/Q&A are optional parent groups; empty groups render as gray dashed cards.
AI never has to populate all groups. Children are consecutive logical parts,
covering the speaker recording without gaps or overlaps. No video files are cut
or re-encoded. The editor supports titles, group reassignment, split at playhead,
dragging or entering a cut time, merging adjacent parts, and undo (last 50 edits).
Adding a group creates a real part: the whole recording if empty, or a split of
the selected part at the playhead (midpoint if the playhead is outside that part).

Import timed SRT/VTT on either recording's timeline, or run local English ASR on
the speaker video. Untimed scripts are optional context for topic recognition;
actual boundaries are anchored to timed transcript cues. ASR and DeepSeek outline
requests run in a background worker, with saved transcript, status and recoverable
errors. Full transcript is separate from per-scan transcript excerpts. The AI
proposal is previewed and only replaces saved parts after explicit acceptance.

Scan selection supports parents, children and nonadjacent parts. Each selected
range is clipped to shared footage and that clipping is shown before scanning;
parts entirely outside shared footage are disabled. Unselected gaps are never
scanned. The server snapshots selected IDs, revision and ranges for the task.
Existing observations are associated with the current outline by timestamp in the
review UI, so boundary edits do not need fresh vision requests merely for grouping.

New endpoints: POST `/{id}/outline` (background transcript/AI preparation), PUT
`/{id}/transcript` (SRT/VTT import), PUT `/{id}/parts` (revision-checked edits), POST
`/{id}/scan-parts` (revision and selected IDs). Draft outline generation does not
modify accepted parts. Source replacement resets the outline; changing offset
preserves speaker-timed parts but resets parts derived from screen subtitles.

### Chunked long-recording transcription
Seminar preparation now decodes speaker audio once, adjusts its stream origin to
video time, and selects roughly four-minute chunks with quiet cuts within five
seconds of each target. Two-second context padding surrounds each chunk. At most
two CTranslate2 workers run concurrently; CPU threads are bounded per worker.
The seminar path uses greedy decoding (`beam_size=1`) and word timestamps.
Words are assigned to a single core chunk by their global midpoint. Result times
are clipped to core bounds and assembled in chronological order. This trades
some decoding accuracy for speed; actual speedup depends on hardware and speech.
Each completed chunk is written atomically under the session's
`transcription_chunks` directory, keyed by video path/size/mtime, model settings,
and chunk boundaries. Progress includes done/total counts. Failed or interrupted
preparation can be retried, reusing completed chunks; full_transcript is set only
once every chunk succeeds. Existing full transcripts are reused without redoing
ASR. Partial results are not sent to topic segmentation as if complete.

AI and manual segmentation now share one saved timeline. Successful generation
writes the editable parts directly and increments their revision; there is no
separate proposal preview/accept view. Existing compatible saved proposals migrate
once when reopened. Manual edits continue on those same parts. Regeneration shows
an in-page replacement confirmation before starting, and failure retains the
existing timeline.

Review now displays at most six diverse highlights (two per analysis dimension),
ranked by model importance and reviewer confirmation, omitting similar repeated
actions and inaccurate/uncertain findings. Raw observations remain stored. The
transcript has an off-by-default Gesture notes switch. Each cue receives literal
hand/gesture actions from temporally overlapping reliable observations, or an
explicit unsupported-description message. These are interval-based evidence
annotations, not claims of word-level gesture alignment; toggling does not issue
new model calls. Future scans request only distinctive, actionable events and
return an importance level for highlight selection.

### Doubao example configuration
For an activated image-capable Doubao model on Volcengine Ark, set these backend
variables in the untracked `.env` (replace the placeholder with your own key):

```dotenv
SEMINAR_VISION_MODEL=doubao-seed-2-1-lite-260915
SEMINAR_VISION_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEMINAR_VISION_API_KEY=your_ark_api_key
```

The adapter disables thinking for `doubao-seed-*` models so the JSON answer fits
within the output budget. Each developer/deployment must supply its own key;
credentials, video uploads, ASR caches and session records are never part of git.
