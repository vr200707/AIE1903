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

CHUNK_SIZE = 4 * 1024 * 1024
View = Literal['speaker', 'screen']


class Create(BaseModel):
    profile_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)


class Upload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    total_bytes: StrictInt = Field(gt=0)


class Alignment(BaseModel):
    offset_ms: StrictInt


class Scan(BaseModel):
    start_ms: StrictInt = Field(ge=0)
    end_ms: StrictInt = Field(gt=0)
    audio_view: Literal['speaker', 'screen', 'none'] = 'speaker'


class Review(BaseModel):
    review_status: Literal['pending', 'confirmed', 'inaccurate', 'uncertain']


def get_record(session_id: str) -> dict:
    try:
        return store.read(session_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, 'Seminar not found.')


def editable(record: dict) -> None:
    if record['status'] == 'analyzing':
        raise HTTPException(409, 'Wait for the active scan to finish.')


def public(record: dict, summary: bool = False) -> dict:
    value = {k:v for k,v in record.items() if k != 'uploads'}
    value['uploading_views'] = list(record.get('uploads', {}))
    if summary:
        value = {k:value[k] for k in ('id','profile_id','title','status','updated_at')}
    return value


def create_seminar_router(profile_resolver: Callable[[str], dict]) -> APIRouter:
    router = APIRouter(prefix='/api/seminars', tags=['seminars'])
    recover_interrupted()

    @router.post('', status_code=201)
    def create(body: Create):
        profile_resolver(body.profile_id)
        return public(store.create(body.profile_id, body.title))

    @router.get('')
    def listing(profile_id: str | None = None):
        return [public(r, summary=True) for r in store.list_sessions(profile_id)]

    @router.get('/{session_id}')
    def read(session_id: str):
        return public(get_record(session_id))

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
                details=probe_video(target)
            except InterviewMediaError as exc:
                target.unlink(missing_ok=True)
                raise HTTPException(422,exc.detail)
            import shutil
            old=record['videos'].get(view)
            record['videos'][view]={**details,'filename':target.name,'display_name':meta['display_name'],'size_bytes':meta['total_bytes']}
            del record['uploads'][view]
            record['aligned']=False
            record.pop('overlap',None)
            store.invalidate(record)
            store.save(record)
            shutil.rmtree(chunks,ignore_errors=True)
            shutil.rmtree(folder/'frames',ignore_errors=True)
            if old:
                (folder/old['filename']).unlink(missing_ok=True)
            return public(record)

    @router.post('/{session_id}/alignment')
    def alignment(session_id: str, body: Alignment):
        with store.lock:
            record=get_record(session_id); editable(record)
            if set(record['videos']) != {'speaker','screen'} or record['uploads']:
                raise HTTPException(409,'Finish both uploads first.')
            try:
                bounds=store.overlap(record['videos']['speaker']['duration_ms'],record['videos']['screen']['duration_ms'],body.offset_ms)
            except ValueError as exc:
                raise HTTPException(422,str(exc))
            changed=not record['aligned'] or record['offset_ms']!=body.offset_ms
            record.update(offset_ms=body.offset_ms,aligned=True,overlap=list(bounds))
            if changed:
                store.invalidate(record)
            store.save(record)
            return public(record)

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
