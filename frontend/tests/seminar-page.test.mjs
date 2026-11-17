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
test.after(async()=>rm(temp,{recursive:true,force:true}));
