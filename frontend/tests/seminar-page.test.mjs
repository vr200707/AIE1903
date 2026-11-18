import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const frontend=path.resolve(import.meta.dirname,'..'),temp=path.join(frontend,'.cache','page-test');
await mkdir(temp,{recursive:true});
let source=await readFile(path.join(frontend,'app/seminar/page.tsx'),'utf8');
source=source.replace('import Link from "next/link";','function Link({children,href}){return <a href={href}>{children}</a>;}')
.replace('import { useArchive } from "@/components/ArchiveProvider";','function useArchive(){return {archives:[{profileId:"p",name:"Test"}]};}')
.replace('import Starfield, { HERO_IMAGE } from "@/components/Starfield";','function Starfield(){return null;} const HERO_IMAGE="";')
.replace('import GuideModal, { GUIDE_SEEN_KEY } from "@/components/seminar/GuideModal";','function GuideModal(){return null;} const GUIDE_SEEN_KEY="guide-seen";')
.replace('import PolarBear from "@/components/seminar/PolarBear";','function PolarBear(){return null;}');
for(const component of ['SegmentEditor','AlignmentEvidence','DualVideoPlayer'])source=source.replace(`import ${component} from "@/components/seminar/${component}";`,`function ${component}(){return <div data-component="${component}"/>;}`);
for(const lib of ['seminar-workflow','seminar-parts','seminar-review','seminar'])source=source.replaceAll(`@/lib/${lib}`,pathToFileURL(path.join(frontend,'lib',lib+'.ts')).href);
await writeFile(path.join(temp,'page.mjs'),ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {default:Page}=await import(pathToFileURL(path.join(temp,'page.mjs')).href);
test('restored seminar and navigation do not produce duplicate component keys',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/seminar?session=sem_test&step=2'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.scrollTo=()=>{};
 const record={id:'sem_test',profile_id:'p',title:'Talk',videos:{speaker:{filename:'a.mp4',duration_ms:10000},screen:{filename:'b.mp4',duration_ms:10000}},uploading_views:[],aligned:true,offset_ms:0,overlap:[0,10000],segments:[],status:'ready',stage:'alignment',observations:[],frames:[],transcript:[],warnings:[],progress:{done:0,total:0}};
 const previousFetch=globalThis.fetch,previousError=console.error,errors=[];
 globalThis.fetch=async()=>({ok:true,json:async()=>record});console.error=(...args)=>errors.push(args.join(' '));
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>{root.render(React.createElement(Page));await new Promise(resolve=>setTimeout(resolve,10));});
  assert.ok(document.querySelector('[data-component="AlignmentEvidence"]'));
  assert.ok(document.querySelector('[data-component="DualVideoPlayer"]'));
  for(const name of ['4. Structure','3. Alignment']){
   const button=[...document.querySelectorAll('button')].find(b=>b.textContent===name);
   await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  }
  assert.deepEqual(errors.filter(e=>e.includes('same key')),[]);
 }finally{await act(async()=>root.unmount());console.error=previousError;globalThis.fetch=previousFetch;dom.window.close();}
});
test('file selection stays local and speaker is required; submitting speaker alone skips alignment',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/seminar?session=sem_test&step=1'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.Event=dom.window.Event;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.scrollTo=()=>{};
 let record={id:'sem_test',profile_id:'p',title:'Talk',videos:{},recordings_submitted:false,uploading_views:[],aligned:false,offset_ms:0,segments:[],status:'created',stage:'upload',observations:[],frames:[],transcript:[],warnings:[],progress:{done:0,total:0}};
 const previousFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  const method=options.method??'GET';calls.push([url,method]);
  let result=record;
  if(url.endsWith('/init'))result={upload_id:'u',chunk_size:1024};
  if(url.endsWith('/complete'))record={...record,videos:{speaker:{filename:'speaker.mp4',display_name:'talk.mp4',duration_ms:10000}},recordings_submitted:false};
  if(url.endsWith('/videos/submit'))record={...record,recordings_submitted:true,overlap:[0,10000],status:'ready'};
  return {ok:true,json:async()=>structuredClone(result===record?result:url.endsWith('/complete')||url.endsWith('/videos/submit')?record:result)};
 };
 const root=createRoot(document.getElementById('root'));
 const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
 const select=async(view)=>{
  const input=document.querySelector(`input[aria-label="Upload ${view} recording"]`);
  Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['test'],'talk.mp4',{type:'video/mp4'})]});
  await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
 };
 try {
  await act(async()=>{root.render(React.createElement(Page));await new Promise(r=>setTimeout(r,10));});
  assert.equal(button('Submit recordings').disabled,true);
  await select('screen');
  assert.equal(button('Submit recordings').disabled,true,'screen alone cannot be submitted');
  assert.equal(calls.filter(([,method])=>method!=='GET').length,0,'choosing files must not upload');
  await act(async()=>button('Remove screen recording').click());
  await select('speaker');
  assert.equal(button('Submit recordings').disabled,false);
  assert.equal(calls.filter(([,method])=>method!=='GET').length,0);
  await act(async()=>{button('Submit recordings').click();await new Promise(r=>setTimeout(r,20));});
  assert.ok(calls.some(([url])=>url.endsWith('/videos/submit')));
  assert.ok(!calls.some(([url])=>url.includes('/alignment')));
  assert.ok(!document.querySelector('[aria-label="Seminar workflow"]').textContent.includes('Alignment'));
  assert.equal(document.querySelector('[aria-current="step"]').textContent,'3. Structure');
  await act(async()=>button('← Previous').click());
  assert.equal(document.querySelector('[aria-current="step"]').textContent,'2. Videos');
 } finally {await act(async()=>root.unmount());globalThis.fetch=previousFetch;dom.window.close();}
});

test.after(async()=>rm(temp,{recursive:true,force:true}));
