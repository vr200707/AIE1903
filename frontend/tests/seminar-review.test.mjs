import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewHighlights,sentenceGestures} from '../lib/seminar-review.ts';
const observation=(id,dimension='gesture_usage',extra={})=>({id,dimension,start_ms:Number(id)*1000,end_ms:Number(id)*1000+500,observed_action:'Raises the right hand toward the slide',comment:'test',review_status:'pending',frame_ids:[],...extra});
test('review emphasizes high priority diverse events and removes repetition',()=>{
 const items=Array.from({length:20},(_,i)=>observation(String(i)));
 items.push(observation('21','posture_movement',{importance:3,observed_action:'Walks away from lectern'}));
 const result=reviewHighlights(items);
 assert.equal(result.length,2);assert.ok(result.some(o=>o.id==='21'));
 assert.equal(items.length,21,'raw evidence must remain available');
 assert.equal(reviewHighlights([observation('1','gesture_usage',{review_status:'inaccurate'})]).length,0);
});
test('gesture annotations use only overlapping reliable gesture evidence',()=>{
 const cue={start_ms:1000,end_ms:2000};
 const items=[observation('1'),observation('3'),observation('1','posture_movement'),observation('1','gesture_usage',{review_status:'uncertain'}),observation('1')];
 assert.equal(sentenceGestures(cue,items).length,1);
 assert.equal(sentenceGestures({start_ms:10000,end_ms:11000},items).length,0);
});
