import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// Compile the real component without introducing a browser or alternate React.
// JSX compilation is the same automatic runtime used by the app.
const frontend=path.resolve(import.meta.dirname,'..');
const temporary=path.join(frontend,'.cache','player-test');
await mkdir(temporary,{recursive:true});
const source=(await readFile(path.join(frontend,'components/seminar/DualVideoPlayer.tsx'),'utf8'))
  .replaceAll('@/lib/seminar-timing',pathToFileURL(path.join(frontend,'lib/seminar-timing.ts')).href)
  .replaceAll('@/lib/seminar',pathToFileURL(path.join(frontend,'lib/seminar.ts')).href);
await writeFile(path.join(temporary,'player.mjs'),ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {default:Player}=await import(pathToFileURL(path.join(temporary,'player.mjs')).href);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const readiness=new WeakMap();
Object.defineProperty(dom.window.HTMLMediaElement.prototype,'readyState',{get(){return readiness.get(this) ?? 0;}});
dom.window.HTMLMediaElement.prototype.pause=function(){};
dom.window.HTMLMediaElement.prototype.play=function(){return Promise.resolve();};
const session={id:'demo',videos:{speaker:{filename:'a.mp4',duration_ms:100000},screen:{filename:'b.mp4',duration_ms:100000}}};

test('pending evidence seek survives metadata loading separately for both views',async()=>{
  const root=createRoot(document.getElementById('root'));
  try {
    await act(async()=>root.render(React.createElement(Player,{session,offset:3,seek:{ms:45000,nonce:1}})));
    const [speaker,screen]=document.querySelectorAll('video');
    await act(async()=>{readiness.set(speaker,4);speaker.dispatchEvent(new dom.window.Event('loadedmetadata'));});
    assert.equal(speaker.currentTime,45,'speaker must show requested evidence, not overlap start');
    await act(async()=>{readiness.set(screen,4);screen.dispatchEvent(new dom.window.Event('loadedmetadata'));});
    assert.equal(screen.currentTime,48,'late screen metadata must honor the same canonical position');
  }finally{await act(async()=>root.unmount());}
});

test('new evidence selection updates both loaded players with a negative offset',async()=>{
  const root=createRoot(document.getElementById('root'));
  try{
    await act(async()=>root.render(React.createElement(Player,{session,offset:-3,seek:null})));
    const [speaker,screen]=document.querySelectorAll('video');
    await act(async()=>{for(const video of [speaker,screen]){readiness.set(video,4);video.dispatchEvent(new dom.window.Event('loadedmetadata'));}});
    assert.equal(speaker.currentTime,3);assert.equal(screen.currentTime,0);
    await act(async()=>root.render(React.createElement(Player,{session,offset:-3,seek:{ms:45000,nonce:2}})));
    assert.equal(speaker.currentTime,45);assert.equal(screen.currentTime,42);
  }finally{await act(async()=>root.unmount());}
});

test.after(async()=>{dom.window.close();await rm(temporary,{recursive:true,force:true});});
