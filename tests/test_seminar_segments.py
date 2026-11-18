"""Optional hierarchy, real timing, durable edits and disjoint scanning contracts."""
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from types import SimpleNamespace
from app import seminar_store as store
from app.seminar_segments import validate_parts, parse_subtitles, build_outline, run_job


def part(identifier='p1', start=0, end=10000, group='body'):
    return dict(id=identifier,start_ms=start,end_ms=end,group=group,title='Topic',summary='')


class SegmentValidationTests(unittest.TestCase):
    def test_absent_structure_is_allowed_but_gaps_and_overlaps_are_not(self):
        self.assertEqual(validate_parts([],10000),[])
        self.assertEqual(validate_parts([part()],10000)[0]['group'],'body')
        for parts in ([part(group=[])], [part(start=1)], [part(end=9000)], [part(end=5000),part('p2',4000,10000)], [part(end=5000),part('p1',5000,10000)]):
            with self.assertRaises(ValueError):validate_parts(parts,10000)

    def test_screen_subtitles_map_to_speaker_and_clip(self):
        cues=parse_subtitles('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n\n00:00:04.000 --> 00:00:06.000\nResult',4000,2000)
        self.assertEqual([(c['start_ms'],c['end_ms']) for c in cues],[(0,1000),(2000,4000)])
        with self.assertRaises(ValueError):parse_subtitles('An untimed script is not timestamps.',4000)

    def test_model_boundaries_grounded_to_real_cues_and_no_forced_intro(self):
        cues=[dict(start_ms=100,end_ms=1000,text='method'),dict(start_ms=6000,end_ms=8000,text='results')]
        client=MagicMock()
        client.with_options.return_value.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"parts":[{"cue":0,"group":"body","title":"Method"},{"cue":1,"group":"body","title":"Results"}]}'))])
        with patch('app.seminar_segments.get_client',return_value=client):
            parts=build_outline(cues,10000)
        self.assertEqual([(p['group'],p['start_ms'],p['end_ms']) for p in parts],[('body',0,6000),('body',6000,10000)])
        client.with_options.return_value.chat.completions.create.return_value.choices[0].message.content='{"parts":[{"cue":900,"group":"body","title":"Fake"}]}'
        with patch('app.seminar_segments.get_client',return_value=client), self.assertRaises(ValueError):build_outline(cues,10000)


class SegmentAPITests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.seminar_api import create_seminar_router
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'SEMINAR_DATA_DIR':self.tmp.name});self.env.start()
        app=FastAPI();app.include_router(create_seminar_router(lambda _: {'candidate':{'basic_info':{'name':'Test Candidate'}}}));self.client=TestClient(app)
        self.record=store.create('p','Talk')
        self.record.update(videos={v:{'filename':v+'.mp4','duration_ms':10000} for v in ('speaker','screen')},recordings_submitted=True,aligned=True,overlap=[0,10000])
        store.save(self.record);self.base='/api/seminars/'+self.record['id']

    def tearDown(self):self.env.stop();self.tmp.cleanup()

    def test_parts_roundtrip_revision_conflict_and_invalid_edit(self):
        response=self.client.put(self.base+'/parts',json={'revision':0,'parts':[part()]})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.get(self.base).json()['segments_revision'],1)
        self.assertEqual(self.client.put(self.base+'/parts',json={'revision':0,'parts':[part()]}).status_code,409)
        self.assertEqual(self.client.put(self.base+'/parts',json={'revision':1,'parts':[part(start=2)]}).status_code,422)
        self.assertEqual(store.read(self.record['id'])['segments'][0]['start_ms'],0)

    def test_subtitle_replacement_invalidates_analysis_and_screen_offset_invalidates_parts(self):
        self.record.update(observations=[{'id':'old'}],frames=[{'id':'old'}],transcript=[{'text':'old'}],segments=[part()],segments_revision=4)
        store.save(self.record)
        r=self.client.put(self.base+'/transcript',json={'content':'1\n00:00:00,000 --> 00:00:01,000\nHello','view':'screen'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['observations'],[])
        self.assertEqual(r.json()['transcript'],[])
        r=self.client.post(self.base+'/alignment',json={'offset_ms':1000})
        self.assertEqual(r.status_code,200)
        self.assertNotIn('segments',r.json())
        self.assertNotIn('full_transcript',r.json())
        self.assertEqual(r.json()['segments_revision'],5)

    def test_speaker_transcript_survives_offset_change(self):
        self.record.update(full_transcript=[{'text':'keep'}],transcript_source='speaker_asr',segments=[part()])
        store.save(self.record)
        r=self.client.post(self.base+'/alignment',json={'offset_ms':1000}).json()
        self.assertEqual(r['full_transcript'],[{'text':'keep'}]);self.assertEqual(r['segments'],[part()])

    def test_job_returns_async_and_locks_mutations(self):
        with patch('app.seminar_segments.executor.submit') as submit:
            r=self.client.post(self.base+'/outline',json={'generate':True})
            self.assertEqual(r.status_code,202)
            self.assertEqual(r.json()['outline_job']['status'],'running')
            submit.assert_called_once()
            self.assertEqual(self.client.put(self.base+'/parts',json={'revision':0,'parts':[part()]}).status_code,409)
        from app.seminar_segments import active
        active.discard(self.record['id'])

    def test_failed_model_preserves_saved_parts_and_finished_transcript(self):
        self.record.update(segments=[part()],outline_job={'status':'running'})
        store.save(self.record)
        with patch('app.seminar_segments.transcribe_chunked',return_value={'segments':[dict(segment_id='s',start_ms=0,end_ms=1000,text='test')]}),patch('app.seminar_segments.build_outline',side_effect=ValueError('Bad boundaries')):
            run_job(self.record['id'],True)
        result=store.read(self.record['id'])
        self.assertEqual(result['segments'],[part()]);self.assertEqual(len(result['full_transcript']),1)
        self.assertEqual(result['outline_job']['status'],'failed')

    def test_selection_snapshot_and_noncontiguous_ranges(self):
        self.record.update(segments=[part('a',0,3000),part('b',3000,7000),part('c',7000,10000)],segments_revision=2,overlap=[1000,9000])
        store.save(self.record)
        with patch('app.seminar_api.start_scan',return_value=self.record) as start:
            r=self.client.post(self.base+'/scan-parts',json={'revision':2,'part_ids':['c','a'],'audio_view':'none'})
            self.assertEqual(r.status_code,202)
            self.assertEqual(start.call_args.kwargs['ranges'],[(1000,3000),(7000,9000)])
            self.assertEqual(start.call_args.kwargs['part_ids'],['a','c'])
        self.assertEqual(self.client.post(self.base+'/scan-parts',json={'revision':1,'part_ids':['a']}).status_code,409)

    def test_screen_transcript_gap_not_scanned_or_duplicated(self):
        from app.seminar_service import run_scan
        self.record.update(status='analyzing',progress={'done':0,'total':2},transcript=[dict(segment_id='gap',start_ms=4000,end_ms=5000,text='existing gap')])
        store.save(self.record)
        cues=[dict(segment_id='a',start_ms=0,end_ms=1000,text='selected'),dict(segment_id='gap',start_ms=4000,end_ms=5000,text='gap'),dict(segment_id='c',start_ms=8000,end_ms=9000,text='selected')]
        with patch('app.seminar_service.transcribe_video',return_value={}),patch('app.seminar_service.mapped_transcript',return_value=cues),patch('app.seminar_service.sample_window',return_value=[]) as sample:
            run_scan(self.record['id'],0,10000,'screen',[(0,2000),(8000,10000)])
        self.assertEqual([(c.args[3],c.args[4]) for c in sample.call_args_list],[(0,2000),(0,2000),(8000,10000),(8000,10000)])
        result=store.read(self.record['id'])
        self.assertEqual([c['text'] for c in result['transcript'] if c['segment_id']=='gap'],['existing gap'])

class UnifiedOutlineTests(unittest.TestCase):
    setUp=SegmentAPITests.setUp
    tearDown=SegmentAPITests.tearDown
    def test_completed_ai_outline_is_saved_as_editable_segments(self):
        self.record.update(full_transcript=[dict(segment_id='s',start_ms=0,end_ms=1000,text='test')],outline_job={'status':'running'})
        store.save(self.record)
        with patch('app.seminar_segments.build_outline',return_value=[part()]):
            run_job(self.record['id'],True)
        result=store.read(self.record['id'])
        self.assertEqual(result['segments'],[part()])
        self.assertEqual(result['segments_revision'],1)
        self.assertNotIn('segment_proposal',result)
        edited=part();edited['title']='Manual edit of AI result'
        response=self.client.put(self.base+'/parts',json={'revision':1,'parts':[edited]})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['segments'][0]['title'],edited['title'])

    def test_previous_proposal_migrates_once_to_editable_timeline(self):
        self.record.update(segment_proposal={'base_revision':0,'parts':[part()]})
        store.save(self.record)
        first=self.client.get(self.base).json();second=self.client.get(self.base).json()
        self.assertEqual(first['segments'],[part()])
        self.assertEqual(first['segments_revision'],1)
        self.assertEqual(second['segments_revision'],1)

class EnglishMetadataTests(unittest.TestCase):
    def test_translate_display_fields_preserves_structure(self):
        from app.seminar_segments import english_metadata
        item=part();item['title']='研究方法';item['summary']='方法说明'
        client=MagicMock()
        client.with_options.return_value.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"items":[{"index":0,"title":"Research Methods","summary":"Explanation of the method"}]}'))])
        with patch('app.seminar_segments.get_client',return_value=client):result=english_metadata([item])
        self.assertEqual(result[0]['title'],'Research Methods')
        for key in ('id','start_ms','end_ms','group'):self.assertEqual(result[0][key],item[key])
        self.assertEqual(item['title'],'研究方法')

    def test_already_english_needs_no_model_call(self):
        from app.seminar_segments import english_metadata
        with patch('app.seminar_segments.get_client') as client:
            self.assertEqual(english_metadata([part()]),[part()]);client.assert_not_called()
