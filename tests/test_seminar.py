"""Project 3 contract tests: real storage, bounds and evidence grounding."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class SeminarStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"SEMINAR_DATA_DIR": self.tmp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_store_roundtrip_and_path_traversal(self):
        from app import seminar_store as store
        record = store.create("profile-1", "Research talk")
        self.assertEqual(store.read(record["id"])["profile_id"], "profile-1")
        with self.assertRaises(ValueError):
            store.read("../outside")

    def test_overlap_supports_both_offset_signs(self):
        from app.seminar_store import overlap
        self.assertEqual(overlap(10000, 12000, 3000), (0, 9000))
        self.assertEqual(overlap(10000, 12000, -3000), (3000, 10000))
        with self.assertRaises(ValueError):
            overlap(10000, 12000, 12000)

    def test_upload_bounds_completion_and_alignment_lock(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.seminar_api import create_seminar_router
        app = FastAPI()
        app.include_router(create_seminar_router(lambda _: {}))
        client = TestClient(app)
        record = client.post('/api/seminars', json={'profile_id': 'p1', 'title': 'Talk'}).json()
        base = '/api/seminars/' + record['id']
        self.assertEqual(client.post(base + '/alignment', json={'offset_ms': 0}).status_code, 409)
        for view in ['speaker', 'screen']:
            url = base + '/videos/' + view
            upload = client.post(url + '/init', json={'filename': '../talk.mp4', 'total_bytes': 4}).json()
            path = url + '/uploads/' + upload['upload_id']
            self.assertEqual(client.put(path + '/chunks/0', content=b'123').status_code, 422)
            self.assertEqual(client.put(path + '/chunks/1', content=b'1234').status_code, 422)
            self.assertEqual(client.post(path + '/complete').status_code, 409)
            self.assertEqual(client.put(path + '/chunks/0', content=b'1234').status_code, 200)
            with patch('app.seminar_api.probe_video', return_value={'duration_ms':10000,'width':640,'height':480}):
                self.assertEqual(client.post(path + '/complete').status_code, 200)
        aligned = client.post(base + '/alignment', json={'offset_ms': -1000})
        self.assertEqual(aligned.status_code, 200)
        self.assertEqual(aligned.json()['overlap'], [1000,10000])
        self.assertEqual(client.post(base + '/alignment', json={'offset_ms': 20000}).status_code, 422)
        from app import seminar_store as store
        with store.lock:
            item=store.read(record['id']); item['status']='analyzing'; store.save(item)
        self.assertEqual(client.post(base+'/alignment', json={'offset_ms':0}).status_code,409)
        self.assertEqual(client.post(base+'/videos/screen/init',json={'filename':'x.mp4','total_bytes':4}).status_code,409)


class EvidenceTests(unittest.TestCase):
    def test_grounding_rejects_invented_and_single_speaker_frames(self):
        from app.seminar_analysis import ground_observations
        frames=[{'id':'a','view':'speaker','time_ms':1000}, {'id':'b','view':'speaker','time_ms':2000}, {'id':'c','view':'screen','time_ms':1500}]
        def event(ids):
            return {'dimension':'gesture_usage','observed_action':'Raises a hand','comment':'May indicate the slide.','frame_ids':ids}
        observations, rejected = ground_observations({'observations':[event(['a','b']),event(['a','fake']),event(['a','c'])]},frames)
        self.assertEqual(len(observations),1)
        self.assertEqual((observations[0]['start_ms'],observations[0]['end_ms']),(1000,2000))
        self.assertEqual(rejected,2)
        self.assertEqual(observations[0]['review_status'],'pending')

    def test_frame_sampler_retains_sequence_and_skips_black(self):
        import av
        from PIL import Image
        from app.seminar_media import sample_window
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'sample.mp4'
            with av.open(str(path),'w') as container:
                stream=container.add_stream('mpeg4',rate=2);stream.width=64;stream.height=48;stream.pix_fmt='yuv420p'
                for i in range(8):
                    frame=av.VideoFrame.from_image(Image.new('RGB',(64,48),'black' if i<2 else 'white'))
                    for packet in stream.encode(frame): container.mux(packet)
                for packet in stream.encode():container.mux(packet)
            frames=sample_window(path,Path(tmp)/'frames','speaker',0,4000,0)
            self.assertGreaterEqual(len(frames),2)
            self.assertTrue(all(f['time_ms']>=1000 for f in frames))
            self.assertTrue(all((Path(tmp)/'frames'/f['filename']).exists() for f in frames))

    def test_vision_requires_explicit_model_and_sends_image_content(self):
        from app.seminar_analysis import analyze_window, vision_config
        with patch.dict(os.environ, {'SEMINAR_VISION_MODEL':''}):
            with self.assertRaises(ValueError): vision_config()
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'a.jpg';path.write_bytes(b'jpeg-test')
            client=unittest.mock.MagicMock()
            client.__enter__.return_value=client
            client.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"observations":[]}'))])
            with patch.dict(os.environ, {'SEMINAR_VISION_MODEL':'vision-test','SEMINAR_VISION_API_KEY':'test-key'}),patch('app.seminar_analysis.OpenAI',return_value=client):
                analyze_window([{'id':'a','view':'speaker','time_ms':1000,'filename':'a.jpg'}],Path(tmp),[])
            kwargs=client.chat.completions.create.call_args.kwargs
            self.assertEqual(kwargs['model'],'vision-test')
            blocks=kwargs['messages'][1]['content']
            self.assertTrue(any(b['type']=='image_url' and b['image_url']['url'].startswith('data:image/jpeg;base64,') for b in blocks))



class SeminarPipelineTests(unittest.TestCase):
    def setUp(self):
        from app import seminar_store as store
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'SEMINAR_DATA_DIR':self.tmp.name,'SEMINAR_VISION_MODEL':'vision-test','SEMINAR_VISION_API_KEY':'test'})
        self.env.start()
        self.record=store.create('p1','Talk')
        self.record.update(aligned=True,offset_ms=-1000,overlap=[1000,9000],status='ready',videos={
            'speaker':{'filename':'speaker.mp4','duration_ms':9000},'screen':{'filename':'screen.mp4','duration_ms':8000}})
        import av
        from PIL import Image,ImageDraw
        for view in ('speaker','screen'):
            with av.open(str(store.directory(self.record['id'])/f'{view}.mp4'),'w') as container:
                stream=container.add_stream('mpeg4',rate=2);stream.width=160;stream.height=120;stream.pix_fmt='yuv420p'
                for i in range(18 if view=='speaker' else 16):
                    image=Image.new('RGB',(160,120),'white');ImageDraw.Draw(image).rectangle((i*5,20,i*5+10,60),fill='blue')
                    for packet in stream.encode(av.VideoFrame.from_image(image)):container.mux(packet)
                for packet in stream.encode():container.mux(packet)
        store.save(self.record)

    def tearDown(self):
        from app.seminar_service import active
        active.discard(self.record['id'])
        self.env.stop();self.tmp.cleanup()

    def test_pipeline_keeps_evidence_when_audio_missing_and_review_persists(self):
        from app import seminar_store as store
        from app.seminar_service import run_scan
        def response(frames,folder,transcript):
            self.assertTrue(all((folder/f['filename']).exists() for f in frames))
            speaker=[f for f in frames if f['view']=='speaker']
            screen=[f for f in frames if f['view']=='screen']
            self.assertTrue(all(f['source_ms']==f['time_ms']-1000 for f in screen))
            return {'observations':[{'dimension':'gesture_usage','observed_action':'Moves the right hand.',
                    'comment':'May emphasize the explanation.','frame_ids':[speaker[0]['id'],speaker[1]['id'],screen[0]['id']]}]}
        with patch('app.seminar_service.transcribe_video',side_effect=ValueError('no audio')),patch('app.seminar_service.analyze_window',side_effect=response):
            run_scan(self.record['id'],1000,9000,'screen')
        saved=store.read(self.record['id'])
        self.assertEqual(saved['status'],'completed_with_warnings')
        self.assertEqual(len(saved['observations']),1)
        self.assertTrue(any('Transcript unavailable' in w for w in saved['warnings']))
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.seminar_api import create_seminar_router
        app=FastAPI();app.include_router(create_seminar_router(lambda _:{}));client=TestClient(app)
        base='/api/seminars/'+saved['id']
        observation=saved['observations'][0]
        self.assertEqual(client.patch(base+'/observations/'+observation['id'],json={'review_status':'confirmed'}).status_code,200)
        self.assertEqual(store.read(saved['id'])['observations'][0]['review_status'],'confirmed')
        self.assertEqual(client.get(base+'/frames/'+observation['frame_ids'][0]).headers['content-type'],'image/jpeg')
        self.assertEqual(client.get(base+'/frames/not-real').status_code,404)
        self.assertEqual(client.get(base+'/videos/screen',headers={'Range':'bytes=0-15'}).status_code,206)
        # A provider outage on retry must retain the previous reviewed result.
        with patch('app.seminar_service.analyze_window',side_effect=RuntimeError('unavailable')):
            run_scan(saved['id'],1000,9000,'none')
        retried=store.read(saved['id'])
        self.assertEqual(retried['status'],'failed')
        self.assertEqual(retried['observations'][0]['review_status'],'confirmed')

    def test_scan_range_and_duplicate_call_guard(self):
        from app.seminar_service import start_scan
        with self.assertRaises(ValueError):start_scan(self.record['id'],0,5000,'none')
        with patch('app.seminar_service.executor.submit') as submit:
            start_scan(self.record['id'],1000,9000,'none')
            start_scan(self.record['id'],1000,9000,'none')
            self.assertEqual(submit.call_count,1)

    def test_screen_transcript_maps_to_speaker_clock(self):
        from app.seminar_media import mapped_transcript
        result=mapped_transcript({'segments':[{'segment_id':'s1','start_ms':0,'end_ms':2000,'text':'Hello'}]},'screen',-1000,1000,9000)
        self.assertEqual((result[0]['start_ms'],result[0]['end_ms']),(1000,3000))

    def test_malformed_dimension_is_rejected_not_crashed(self):
        from app.seminar_analysis import ground_observations
        result,count=ground_observations({'observations':[{'dimension':{},'frame_ids':[]}]},[])
        self.assertEqual((result,count),([],1))


    def test_successful_rescan_removes_cross_batch_stale_observation(self):
        from app import seminar_store as store
        from app.seminar_service import run_scan
        self.record['observations']=[{'id':'old','dimension':'gesture_usage','observed_action':'Old action',
            'comment':'Old comment','frame_ids':[], 'start_ms':6000,'end_ms':10000,'review_status':'confirmed'}]
        store.save(self.record)
        # Isolate successful-coverage replacement from media decoding, which is
        # exercised above. The old event spans the 8-second batch boundary.
        def sample(path,folder,view,start,end,offset):
            return [{'id':f'{view}_{start}', 'view':view,'time_ms':start,'source_ms':start,'filename':'a.jpg'},
                    {'id':f'{view}_{start+1000}', 'view':view,'time_ms':start+1000,'source_ms':start+1000,'filename':'b.jpg'}]
        with patch('app.seminar_service.sample_window',side_effect=sample),patch('app.seminar_service.analyze_window',return_value={'observations':[]}):
            run_scan(self.record['id'],0,16000,'none')
        self.assertEqual(store.read(self.record['id'])['observations'],[])

if __name__ == '__main__': unittest.main()
