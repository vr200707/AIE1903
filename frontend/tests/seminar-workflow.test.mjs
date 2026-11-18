import test from 'node:test';
import assert from 'node:assert/strict';
import {lastUnlockedStep,allowedStep} from '../lib/seminar-workflow.ts';
test('steps unlock only after prerequisite completion',()=>{
 assert.equal(lastUnlockedStep(null),0);
 const record={videos:{},uploading_views:[],aligned:false,status:'created'};
 assert.equal(lastUnlockedStep(record),1);
 record.videos={speaker:{},screen:{}};
 assert.equal(lastUnlockedStep(record),2);
 record.aligned=true;
 assert.equal(lastUnlockedStep(record),3);
 record.segments=[{id:'part'}];
 assert.equal(lastUnlockedStep(record),4);
 record.status='analyzing';assert.equal(lastUnlockedStep(record),4);
 record.status='failed';assert.equal(lastUnlockedStep(record),4);
 record.status='completed';assert.equal(lastUnlockedStep(record),5);
 assert.equal(lastUnlockedStep(record,true,true),3);
 assert.equal(lastUnlockedStep(record,false),2);
 record.uploading_views=['speaker'];assert.equal(lastUnlockedStep(record),1);
});
test('direct URLs and history clamp to reachable step',()=>{
 for(let max=0;max<=5;max++)assert.equal(allowedStep(5,max),max);
 assert.equal(allowedStep(NaN,3),0);
 assert.equal(allowedStep(-1,3),0);
 assert.equal(allowedStep(1.5,3),0);
});

test('speaker-only sessions require submission, then skip alignment in both directions and direct URLs',async()=>{
 const {workflowSteps,availableStep}=await import('../lib/seminar-workflow.ts');
 const record={videos:{speaker:{}},recordings_submitted:false,uploading_views:[],aligned:false,status:'created'};
 assert.equal(lastUnlockedStep(record),1);
 record.recordings_submitted=true;
 assert.equal(lastUnlockedStep(record),3);
 const visible=workflowSteps(record);
 assert.deepEqual(visible,[0,1,3,4,5]);
 assert.equal(visible[visible.indexOf(1)+1],3);
 assert.equal(visible[visible.indexOf(3)-1],1);
 assert.equal(availableStep(2,3,visible),3);
 record.segments=[{id:'part'}];assert.equal(lastUnlockedStep(record),4);
 record.videos.screen={};assert.equal(lastUnlockedStep(record),2);
 assert.deepEqual(workflowSteps(record),[0,1,2,3,4,5]);
});
