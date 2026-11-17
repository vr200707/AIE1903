import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPart,moveBoundary,mergeBoundary,sharedPart} from '../lib/seminar-parts.ts';
const original=[{id:'a',title:'Method',group:'body',start_ms:0,end_ms:10000,summary:''}];
test('split, move and merge retain contiguous time coverage and undo snapshots',()=>{
 const split=splitPart(original,'a',4000,'b','conclusion');
 assert.deepEqual(split.map(p=>[p.group,p.start_ms,p.end_ms]),[['body',0,4000],['conclusion',4000,10000]]);
 const moved=moveBoundary(split,1,6000);
 assert.equal(moved[0].end_ms,moved[1].start_ms);assert.equal(split[0].end_ms,4000);
 assert.deepEqual(mergeBoundary(moved,1).map(p=>[p.start_ms,p.end_ms]),[[0,10000]]);
 assert.equal(original[0].end_ms,10000);assert.equal(original.length,1);
});
test('invalid cuts rejected and shared scan range clips explicitly',()=>{
 for(const at of [0,10000,NaN,100.5])assert.throws(()=>splitPart(original,'a',at,'b'));
 assert.throws(()=>moveBoundary(splitPart(original,'a',4000,'b'),1,10000));
 assert.deepEqual(sharedPart(original[0],[2000,8000]),[2000,8000]);assert.equal(sharedPart(original[0],[11000,12000]),null);
 assert.equal(splitPart([{...original[0],title:'x'.repeat(200)}],'a',1000,'b')[1].title.length,200);
});
