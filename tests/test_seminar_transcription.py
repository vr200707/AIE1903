import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch, MagicMock
import numpy as np
from app.seminar_transcription import transcribe_chunk,transcribe_chunked,chunk_bounds,RATE

class ChunkASRTests(unittest.TestCase):
    def test_boundary_words_have_one_owner_and_global_timestamps(self):
        # Same sentence heard on both sides of a 4s core boundary.
        model=MagicMock()
        words=[NS(start=1.5,end=2.5,word=' hello'),NS(start=2.5,end=3,word=' world')]
        model.transcribe.return_value=(iter([NS(words=words,avg_logprob=-0.1,no_speech_prob=0)]),None)
        later=transcribe_chunk(model,np.zeros(RATE*8),4000,8000,8000)
        self.assertEqual(later[0]['text'],'hello world')
        self.assertEqual((later[0]['start_ms'],later[0]['end_ms']),(4000,5000))
        model.transcribe.return_value=(iter([NS(words=[NS(start=3.5,end=4.5,word=' hello')],avg_logprob=0,no_speech_prob=0)]),None)
        earlier=transcribe_chunk(model,np.zeros(RATE*8),0,4000,8000)
        self.assertEqual(earlier,[])

    def test_cuts_cover_audio_and_seek_quiet_intervals(self):
        audio=np.ones(RATE*11,dtype=np.float32)
        audio[3*RATE:4*RATE]=0
        with patch('app.seminar_transcription.CHUNK_SECONDS',6):
            bounds=chunk_bounds(audio,11000)
        self.assertEqual(bounds[0][0],0);self.assertEqual(bounds[-1][1],11000)
        self.assertTrue(3000<=bounds[0][1]<4000)
        self.assertTrue(all(a[1]==b[0] for a,b in zip(bounds,bounds[1:])))

    def test_failed_chunks_resume_and_completed_chunks_are_not_repeated(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'video.mp4';path.write_bytes(b'fixture')
            container=MagicMock();container.__enter__.return_value.streams=NS(audio=[NS(start_time=0,time_base=1)],video=[NS(start_time=0,time_base=1)])
            calls=[];fail=[True]
            def transcribe(model,audio,start,end,total):
                calls.append(start)
                if start==4000 and fail[0]:raise RuntimeError('temporary')
                return [dict(start_ms=start,end_ms=end,text='speech')]
            with patch('app.seminar_transcription.get_model'),patch('app.seminar_transcription._decode_audio',return_value=np.zeros(RATE*8)),patch('app.seminar_transcription.chunk_bounds',return_value=[(0,4000),(4000,8000)]),patch('av.open',return_value=container),patch('app.seminar_transcription.transcribe_chunk',side_effect=transcribe):
                progress=[]
                with self.assertRaises(ValueError):transcribe_chunked(path,8000,Path(temp)/'cache',lambda d,t,c,m:progress.append((d,t)))
                self.assertIn((1,2),progress)
                fail[0]=False
                result=transcribe_chunked(path,8000,Path(temp)/'cache')
                self.assertEqual(calls.count(0),1);self.assertEqual(calls.count(4000),2)
                self.assertEqual([s['start_ms'] for s in result['segments']],[0,4000])
                before=len(calls);transcribe_chunked(path,8000,Path(temp)/'cache');self.assertEqual(len(calls),before)
