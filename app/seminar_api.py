"""Candidate-linked dual-view upload, alignment, scan and evidence review API."""
from __future__ import annotations
import math
import uuid
from typing import Callable, Literal
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictInt
from app import seminar_store as store
from app.interview_media import probe_video, validate_video_suffix, max_video_bytes, InterviewMediaError
from app.seminar_service import start_scan, recover_interrupted
from app.seminar_alignment import estimate_offset
from app import seminar_segments as segments

CHUNK_SIZE = 4 * 1024 * 1024
View = Literal['speaker', 'screen']


class Create(BaseModel):
    profile_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)


class Upload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    total_bytes: StrictInt = Field(gt=0)


class RecordingSubmission(BaseModel):
    include_screen: bool = True


class Alignment(BaseModel):
    offset_ms: StrictInt


class Scan(BaseModel):
    start_ms: StrictInt = Field(ge=0)
    end_ms: StrictInt = Field(gt=0)
    audio_view: Literal['speaker', 'screen', 'none'] = 'speaker'


class OutlineRequest(BaseModel):
    generate: bool = True
    script: str = Field(default="", max_length=100000)


class TranscriptImport(BaseModel):
    content: str = Field(max_length=1000000)
    view: View = "speaker"


class PartsUpdate(BaseModel):
    revision: StrictInt = Field(ge=0)
    parts: list[dict] = Field(max_length=300)


class PartsScan(BaseModel):
    revision: StrictInt = Field(ge=0)
    part_ids: list[str] = Field(min_length=1, max_length=300)
    audio_view: Literal["speaker", "screen", "none"] = "speaker"


class Review(BaseModel):
    review_status: Literal['pending', 'confirmed', 'inaccurate', 'uncertain']


def get_record(session_id: str) -> dict:
    try:
        return store.read(session_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, 'Seminar not found.')


def editable(record: dict) -> None:
    if record['status'] == 'analyzing' or record.get('outline_job',{}).get('status') == 'running':
        raise HTTPException(409, 'Wait for the active scan to finish.')


def public(record: dict, summary: bool = False) -> dict:
    value = {k:v for k,v in record.items() if k != 'uploads'}
    value['uploading_views'] = list(record.get('uploads', {}))
    if summary:
        value = {k:value[k] for k in ('id','profile_id','title','status','updated_at','stage','progress')}
    if summary and record.get('outline_job'):
        value['outline_job'] = record['outline_job']
    return value


def create_seminar_router(profile_resolver: Callable[[str], dict]) -> APIRouter:
    router = APIRouter(prefix='/api/seminars', tags=['seminars'])
    recover_interrupted()
    segments.recover_jobs()

    @router.post('', status_code=201)
    def create(body: Create):
        if not body.profile_id.strip() or not body.title.strip():
            raise HTTPException(422, 'Candidate and seminar title are required.')
        profile=profile_resolver(body.profile_id)
        name=((profile.get('candidate') or {}).get('basic_info') or {}).get('name')
        if not isinstance(name,str) or not name.strip():
            raise HTTPException(422, 'Candidate must have a name before creating a seminar.')
        record=store.create(body.profile_id, body.title.strip())
        record['candidate_name']=name.strip()
        store.save(record)
        return public(record)

    @router.get('')
    def listing(profile_id: str | None = None):
        return [public(r, summary=True) for r in store.list_sessions(profile_id)]

    @router.get('/{session_id}')
    def read(session_id: str):
        with store.lock:
            record=get_record(session_id)
            proposal=record.get('segment_proposal')
            if proposal and proposal.get('base_revision')==record.get('segments_revision',0) and record.get('outline_job',{}).get('status')!='running':
                segments.apply_outline(record,proposal['parts'])
                record['outline_job']={'status':'completed','stage':'review','message':'AI sections ready. Edit them directly on the timeline.'}
                store.save(record)
            return public(record)

    @router.post('/{session_id}/videos/{view}/init')
    def init_upload(session_id: str, view: View, body: Upload):
        try:
            suffix = validate_video_suffix(body.filename)
        except InterviewMediaError as exc:
            raise HTTPException(422, exc.detail)
        if body.total_bytes > max_video_bytes():
            raise HTTPException(413, 'Video exceeds the configured size limit.')
        with store.lock:
            record = get_record(session_id)
            editable(record)
            upload_id = uuid.uuid4().hex
            # One pending upload per view. Re-init abandons only unfinished chunks.
            old = record['uploads'].get(view)
            if old:
                import shutil
                shutil.rmtree(store.directory(session_id) / 'uploads' / old['id'], ignore_errors=True)
            record['recordings_submitted'] = False
            record['uploads'][view] = {'id': upload_id, 'suffix': suffix,
                'display_name': body.filename.replace('\\','/').split('/')[-1],
                'total_bytes': body.total_bytes, 'chunk_count': math.ceil(body.total_bytes / CHUNK_SIZE)}
            store.save(record)
            return {'upload_id': upload_id, 'chunk_size': CHUNK_SIZE}

    def upload_meta(record: dict, view: str, upload_id: str) -> dict:
        meta = record['uploads'].get(view)
        if not meta or meta['id'] != upload_id:
            raise HTTPException(404, 'Upload session not found.')
        return meta

    @router.put('/{session_id}/videos/{view}/uploads/{upload_id}/chunks/{index}')
    async def chunk(session_id: str, view: View, upload_id: str, index: int, request: Request):
        # Bounded streaming prevents arbitrarily large chunk bodies in memory.
        data = bytearray()
        async for part in request.stream():
            data.extend(part)
            if len(data) > CHUNK_SIZE:
                raise HTTPException(413, 'Chunk exceeds 4 MiB.')
        with store.lock:
            record = get_record(session_id); editable(record)
            meta = upload_meta(record, view, upload_id)
            if not 0 <= index < meta['chunk_count']:
                raise HTTPException(422, 'Invalid chunk index.')
            expected = min(CHUNK_SIZE, meta['total_bytes']-index*CHUNK_SIZE)
            if len(data) != expected:
                raise HTTPException(422, 'Chunk size does not match the upload manifest.')
            folder = store.directory(session_id) / 'uploads' / upload_id
            folder.mkdir(parents=True, exist_ok=True)
            temporary = folder / f'{index}.tmp'
            temporary.write_bytes(data)
            temporary.replace(folder / str(index))
            return {'received': len(data)}

    @router.post('/{session_id}/videos/{view}/uploads/{upload_id}/complete')
    def complete(session_id: str, view: View, upload_id: str):
        with store.lock:
            record=get_record(session_id); editable(record)
            meta=upload_meta(record,view,upload_id)
            folder=store.directory(session_id)
            chunks=folder/'uploads'/upload_id
            if any(not (chunks/str(i)).exists() for i in range(meta['chunk_count'])):
                raise HTTPException(409,'Upload is incomplete.')
            target=folder/(view+'-'+upload_id+meta['suffix'])
            with target.open('wb') as out:
                for i in range(meta['chunk_count']):
                    out.write((chunks/str(i)).read_bytes())
            try:
                details=probe_video(target, enforce_duration_limit=False)
            except InterviewMediaError as exc:
                target.unlink(missing_ok=True)
                raise HTTPException(422,exc.detail)
            import shutil
            old=record['videos'].get(view)
            record['videos'][view]={**details,'filename':target.name,'display_name':meta['display_name'],'size_bytes':meta['total_bytes']}
            del record['uploads'][view]
            record['aligned']=False
            record['recordings_submitted']=False
            for key in ('full_transcript','partial_transcript','transcript_source','segment_proposal','segments','outline_job','script_context'):
                record.pop(key,None)
            record['segments_revision']=record.get('segments_revision',0)+1
            record.pop('alignment_suggestion',None)
            record.pop('overlap',None)
            store.invalidate(record)
            store.save(record)
            shutil.rmtree(chunks,ignore_errors=True)
            shutil.rmtree(folder/'frames',ignore_errors=True)
            if old:
                (folder/old['filename']).unlink(missing_ok=True)
            return public(record)

    @router.post('/{session_id}/videos/submit')
    def submit_recordings(session_id: str, body: RecordingSubmission):
        with store.lock:
            record=get_record(session_id); editable(record)
            if not record['videos'].get('speaker'):
                raise HTTPException(422, 'Speaker recording is required.')
            if any(view!='screen' or body.include_screen for view in record.get('uploads',{})):
                raise HTTPException(409, 'Finish the pending uploads before submitting.')
            abandoned=record['uploads'].pop('screen',None) if not body.include_screen else None
            if not body.include_screen and record['videos'].get('screen'):
                old=record['videos'].pop('screen')
                record.update(aligned=False,offset_ms=0)
                record.pop('alignment_suggestion',None)
                if record.get('transcript_source')=='screen_subtitles':
                    for key in ('full_transcript','segments','segment_proposal','outline_job'):
                        record.pop(key,None)
                    record['segments_revision']=record.get('segments_revision',0)+1
                store.invalidate(record)
                # Keep old media on disk until the new metadata has been persisted.
            else:
                old=None
            record['recordings_submitted']=True
            if not record['videos'].get('screen'):
                record.update(offset_ms=0, aligned=False,
                              overlap=[0,record['videos']['speaker']['duration_ms']],
                              status='ready' if record['status']=='created' else record['status'],stage='structure')
            store.save(record)
            if old:
                (store.directory(session_id)/old['filename']).unlink(missing_ok=True)
            if abandoned:
                import shutil
                shutil.rmtree(store.directory(session_id)/'uploads'/abandoned['id'],ignore_errors=True)
            return public(record)

    @router.post('/{session_id}/alignment/estimate')
    def estimate_alignment(session_id: str):
        with store.lock:
            record=get_record(session_id); editable(record)
            if set(record['videos']) != {'speaker','screen'} or record['uploads'] or not record.get('recordings_submitted',record.get('aligned',False)):
                raise HTTPException(409,'Submit both recordings first.')
            filenames={v:record['videos'][v]['filename'] for v in ('speaker','screen')}
        folder=store.directory(session_id)
        try:
            suggestion=estimate_offset(folder/filenames['speaker'],folder/filenames['screen'])
        except Exception:
            suggestion={'offset_ms':None,'reliable':False,'score':0.0,
                        'message':'Could not decode a shared audio match. Adjust the offset manually.'}
        with store.lock:
            record=get_record(session_id); editable(record)
            if any(record['videos'].get(v,{}).get('filename')!=filenames[v] for v in filenames) or record['uploads']:
                raise HTTPException(409,'The recordings changed. Estimate again after uploads finish.')
            record['alignment_suggestion']=suggestion
            store.save(record)
        return public(record)

    @router.post('/{session_id}/alignment')
    def alignment(session_id: str, body: Alignment):
        with store.lock:
            record=get_record(session_id); editable(record)
            if set(record['videos']) != {'speaker','screen'} or record['uploads'] or not record.get('recordings_submitted',record.get('aligned',False)):
                raise HTTPException(409,'Submit both recordings first.')
            try:
                bounds=store.overlap(record['videos']['speaker']['duration_ms'],record['videos']['screen']['duration_ms'],body.offset_ms)
            except ValueError as exc:
                raise HTTPException(422,str(exc))
            changed=not record['aligned'] or record['offset_ms']!=body.offset_ms
            record.update(offset_ms=body.offset_ms,aligned=True,overlap=list(bounds))
            if changed:
                if record.get('transcript_source') == 'screen_subtitles':
                    record.pop('full_transcript',None)
                    record.pop('segments',None)
                    record['segments_revision']=record.get('segments_revision',0)+1
                    record.pop('segment_proposal',None)
                store.invalidate(record)
            store.save(record)
            return public(record)

    @router.post('/{session_id}/outline', status_code=202)
    def prepare_outline(session_id: str, body: OutlineRequest):
        get_record(session_id)
        try:
            return public(segments.start_job(session_id,body.generate,body.script))
        except ValueError as exc:
            raise HTTPException(422,str(exc))

    @router.put('/{session_id}/transcript')
    def import_transcript(session_id: str, body: TranscriptImport):
        with store.lock:
            record=get_record(session_id);editable(record)
            if not store.recordings_ready(record):
                raise HTTPException(409,'Submit the speaker recording and confirm alignment if a screen recording is included.')
            if body.view not in record['videos']:
                raise HTTPException(422,'This subtitle timeline has no uploaded recording.')
            try:
                cues=segments.parse_subtitles(body.content,record['videos']['speaker']['duration_ms'],record['offset_ms'] if body.view=='screen' else 0)
            except ValueError as exc:
                raise HTTPException(422,str(exc))
            store.invalidate(record)
            record['full_transcript']=cues
            record['transcript_source']=body.view+'_subtitles'
            record.pop('segment_proposal',None)
            record['outline_job']={'status':'completed','stage':'transcript','message':'Timed transcript imported. Generate an AI draft or edit your saved parts.'}
            store.save(record)
            return public(record)

    @router.put('/{session_id}/parts')
    def save_parts(session_id: str, body: PartsUpdate):
        with store.lock:
            record=get_record(session_id);editable(record)
            if not store.recordings_ready(record):
                raise HTTPException(409,'Submit the speaker recording and confirm alignment if a screen recording is included.')
            if body.revision != record.get('segments_revision',0):
                raise HTTPException(409,'Parts changed in another tab. Reload before saving.')
            try:
                record['segments']=segments.validate_parts(body.parts,record['videos']['speaker']['duration_ms'])
            except ValueError as exc:
                raise HTTPException(422,str(exc))
            record['segments_revision']=body.revision+1
            record.pop('segment_proposal',None)
            store.save(record)
            return public(record)

    @router.post('/{session_id}/scan-parts', status_code=202)
    def scan_parts(session_id: str, body: PartsScan):
        with store.lock:
            record=get_record(session_id);editable(record)
            if body.revision != record.get('segments_revision',0):
                raise HTTPException(409,'Parts changed. Reload your selection.')
            known={part['id']:part for part in record.get('segments',[])}
            if any(identifier not in known for identifier in body.part_ids):
                raise HTTPException(422,'Select saved parts from this seminar.')
            selected=sorted((known[i] for i in set(body.part_ids)),key=lambda p:p['start_ms'])
            if not record.get('overlap'):
                raise HTTPException(409,'Confirm alignment first.')
            low,high=record['overlap']
            ranges=[(max(low,p['start_ms']),min(high,p['end_ms'])) for p in selected]
            if any(end<=start for start,end in ranges):
                raise HTTPException(422,'One selected part is outside the shared video range.')
            try:
                return public(start_scan(session_id,ranges[0][0],ranges[-1][1],body.audio_view,
                    ranges=ranges,part_ids=[p['id'] for p in selected],revision=body.revision))
            except ValueError as exc:
                raise HTTPException(422,str(exc))

    @router.post('/{session_id}/scan', status_code=202)
    def scan(session_id: str, body: Scan):
        get_record(session_id)
        try:
            return public(start_scan(session_id,body.start_ms,body.end_ms,body.audio_view))
        except ValueError as exc:
            raise HTTPException(422,str(exc))

    @router.patch('/{session_id}/observations/{observation_id}')
    def review(session_id: str, observation_id: str, body: Review):
        with store.lock:
            record=get_record(session_id); editable(record)
            observation=next((o for o in record['observations'] if o['id']==observation_id),None)
            if observation is None: raise HTTPException(404,'Observation not found.')
            observation['review_status']=body.review_status
            store.save(record)
            return public(record)

    @router.get('/{session_id}/videos/{view}')
    def video(session_id: str, view: View):
        record=get_record(session_id)
        if view not in record['videos']: raise HTTPException(404,'Video not uploaded.')
        return FileResponse(store.directory(session_id)/record['videos'][view]['filename'])

    @router.get('/{session_id}/frames/{frame_id}')
    def frame(session_id: str, frame_id: str):
        record=get_record(session_id)
        evidence=next((f for f in record['frames'] if f['id']==frame_id),None)
        if evidence is None: raise HTTPException(404,'Frame not found.')
        return FileResponse(store.directory(session_id)/'frames'/evidence['filename'], media_type='image/jpeg')

    return router
