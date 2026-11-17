import unittest
import numpy as np
from app.seminar_alignment import estimate_envelopes

class AlignmentTests(unittest.TestCase):
    def test_positive_screen_delay_with_gain(self):
        rng=np.random.default_rng(12)
        signal=rng.random(6000)
        screen=np.concatenate([rng.random(175),signal*3])
        result=estimate_envelopes(signal,screen)
        self.assertEqual(result['offset_ms'],3500)
        self.assertTrue(result['reliable'])

    def test_negative_offset(self):
        rng=np.random.default_rng(3)
        signal=rng.random(6000)
        result=estimate_envelopes(np.r_[rng.random(100),signal],signal)
        self.assertEqual(result['offset_ms'],-2000)
        self.assertTrue(result['reliable'])

    def test_silence_and_unrelated_audio_not_reliable(self):
        self.assertFalse(estimate_envelopes(np.zeros(6000),np.zeros(6000))['reliable'])
        rng=np.random.default_rng(1)
        self.assertFalse(estimate_envelopes(rng.random(6000),rng.random(6000))['reliable'])

class MultiPointTests(unittest.TestCase):
    def estimate(self, offsets):
        from unittest.mock import patch, MagicMock
        from pathlib import Path
        from app.seminar_alignment import estimate_offset
        container=MagicMock()
        container.__enter__.return_value.duration=600_000_000
        values=[{'offset_ms':offset,'reliable':True,'score':1.0,'message':''} for offset in offsets]
        with patch('app.seminar_alignment.audio_envelope',return_value=np.ones(3000)), patch('app.seminar_alignment.estimate_envelopes',side_effect=values), patch('av.open',return_value=container):
            return estimate_offset(Path('speaker'),Path('screen'))

    def test_matching_audio_never_verifies_pictures(self):
        result=self.estimate([2000,0,20,-20])
        self.assertTrue(result['reliable'])
        self.assertFalse(result['visual_verified'])
        self.assertFalse(result['drift_detected'])
        self.assertEqual([x['offset_ms'] for x in result['checkpoints']],[2000,2020,1980])

    def test_drift_withdraws_fixed_offset(self):
        result=self.estimate([2000,0,400,1000])
        self.assertTrue(result['drift_detected'])
        self.assertFalse(result['reliable'])
        self.assertIsNone(result['offset_ms'])
