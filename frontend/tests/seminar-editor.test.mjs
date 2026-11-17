import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const frontend=path.resolve(import.meta.dirname,'..'),temporary=path.join(frontend,'.cache','editor-test');
await mkdir(temporary,{recursive:true});
const source=(await readFile(path.join(frontend,'components/seminar/SegmentEditor.tsx'),'utf8'))
 .replace('import DualVideoPlayer from "./DualVideoPlayer";', 'function DualVideoPlayer({onTime,seek}) {return <div><button onClick={()=>onTime(5000)}>Test playhead</button><output data-testid="requested-seek">{seek?.ms}</output></div>;}')
 .replaceAll('@/lib/seminar-parts',pathToFileURL(path.join(frontend,'lib/seminar-parts.ts')).href)
 .replaceAll('@/lib/seminar',pathToFileURL(path.join(frontend,'lib/seminar.ts')).href);
await writeFile(path.join(temporary,'editor.mjs'),ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {default:Editor}=await import(pathToFileURL(path.join(temporary,'editor.mjs')).href);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const session={id:'demo',offset_ms:0,overlap:[0,10000],videos:{speaker:{duration_ms:10000},screen:{duration_ms:10000}},segments:[]};
const click=async(el)=>{assert.ok(el);await act(async()=>el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
const button=(text)=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
test('missing structures gray, manual addition colors selected section, undo restores absence',async()=>{
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(Editor,{session,active:true,locked:false,onSave:async()=>{},onPrepare:()=>{},onImport:()=>{},onDirty:()=>{}})));
  for(const title of ['Transcript source','Section overview','Speaker timeline','Synced preview','Edit part or cut','Transcript of the selected part']){
    assert.ok(document.body.textContent.includes(title),`missing block: ${title}`);
  }
  assert.equal(document.querySelector('[data-group="body"]').dataset.empty,'true');
  await click(document.querySelector('[data-group="body"] button'));
  assert.equal(document.querySelector('[data-group="body"]').dataset.empty,'false');
  assert.equal(document.querySelector('[data-group="introduction"]').dataset.empty,'true');
  assert.equal(document.querySelector('[data-group="conclusion"]').dataset.empty,'true');
  await click(button('↶ Undo'));
  assert.equal(document.querySelector('[data-group="body"]').dataset.empty,'true');
 }finally{await act(async()=>root.unmount());}
});
test('manual split and merge save actual edited parts',async()=>{
 const root=createRoot(document.getElementById('root'));let saved;
 try{
  await act(async()=>root.render(React.createElement(Editor,{session,active:true,locked:false,onSave:async p=>{saved=p;},onPrepare:()=>{},onImport:()=>{},onDirty:()=>{}})));
  await click(document.querySelector('[data-group="body"] button'));await click(button('Test playhead'));await click(button('+ Split at playhead'));await click(button('Save parts'));
  assert.deepEqual(saved.map(p=>[p.start_ms,p.end_ms]),[[0,5000],[5000,10000]]);
  await click(document.querySelector('[aria-label="Cut at 00:05"]'));await click(button('Remove cut & merge'));await click(button('Save parts'));
  assert.deepEqual(saved.map(p=>[p.start_ms,p.end_ms]),[[0,10000]]);
 }finally{await act(async()=>root.unmount());}
});
test('clicking an AI part seeks to its beginning and shows only its transcript',async()=>{
 const root=createRoot(document.getElementById('root'));
 const aiSession={...session,segments:[{id:'intro',title:'Opening',group:'introduction',start_ms:0,end_ms:4000},{id:'body',title:'Methods',group:'body',start_ms:4000,end_ms:10000}],full_transcript:[{segment_id:'a',start_ms:500,end_ms:2000,text:'Opening words'},{segment_id:'b',start_ms:5000,end_ms:7000,text:'Methods words'}]};
 try{
  await act(async()=>root.render(React.createElement(Editor,{session:aiSession,active:true,locked:false,onSave:async()=>{},onPrepare:()=>{},onImport:()=>{},onDirty:()=>{}})));
  assert.ok(document.body.textContent.includes('Opening words'));assert.ok(!document.body.textContent.includes('Methods words'));
  await click([...document.querySelectorAll('[aria-label="Presentation parts timeline"] button')].find(el=>el.textContent.includes('Methods')));
  assert.equal(document.querySelector('[data-testid="requested-seek"]').textContent,'4000');
  assert.ok(document.body.textContent.includes('Methods words'));assert.ok(!document.body.textContent.includes('Opening words'));
  assert.ok(document.querySelector('summary').textContent.includes('Transcript'));
  const chosen=document.querySelector('[aria-pressed="true"]');assert.ok(chosen.textContent.includes('Methods'));
 }finally{await act(async()=>root.unmount());}
});
test.after(async()=>{dom.window.close();await rm(temporary,{recursive:true,force:true});});
