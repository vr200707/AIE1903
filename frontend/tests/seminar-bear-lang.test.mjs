import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const frontend = path.resolve(import.meta.dirname, '..');
const temporary = path.join(frontend, '.cache', 'bear-lang-test');
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// 让模块内的 new Event() 与 dispatchEvent 走 JSDOM 的实现（Node 全局 Event 不被 JSDOM 接受）
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// 北极熊瞳孔跟随效果依赖 rAF，Node 无此全局，用定时器桩替代
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const transpile = async (rel, rewrites = []) => {
  let source = await readFile(path.join(frontend, rel), 'utf8');
  for (const [from, to] of rewrites) source = source.replace(from, to);
  return ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
};

// IntroOverlay 仅在默认组件里用到 Starfield，本测试只用到语言模块，桩掉该值导入
const introCode = await transpile('components/IntroOverlay.tsx', [
  [/import \{ HERO_IMAGE \} from "\.\/Starfield";/, 'const HERO_IMAGE = "";'],
]);
const introPath = path.join(temporary, 'intro.mjs');
await writeFile(introPath, introCode);
const introUrl = pathToFileURL(introPath).href;

const bearCode = await transpile('components/seminar/PolarBear.tsx', [
  ['@/components/IntroOverlay', introUrl],
]);
const bearPath = path.join(temporary, 'bear.mjs');
await writeFile(bearPath, bearCode);
const { default: PolarBear } = await import(pathToFileURL(bearPath).href);
const { LANG_KEY } = await import(introUrl);

const EN_TIP = 'Pick a saved candidate profile and give this seminar session a title.';
const ZH_TIP = '选择一个已保存的候选人档案，并为本次研讨会填写标题。';

const renderBear = async () => {
  const root = createRoot(document.getElementById('root'));
  await act(async () =>
    root.render(React.createElement(PolarBear, { step: 0, stepTitle: 'Setup' })),
  );
  return root;
};

const click = async (el) => {
  assert.ok(el, 'click target exists');
  await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
};

test('clicking the bear toggles UI language and persists it as the default', async () => {
  window.localStorage.removeItem(LANG_KEY);
  const root = await renderBear();
  try {
    // 默认英文：提示与语言药丸均为英文态
    assert.ok(document.body.textContent.includes(EN_TIP), 'English tip shown by default');
    assert.ok(document.body.textContent.includes('saved as the default'), 'default-language hint shown');

    // 点击熊身：切到中文并写入共享偏好
    const bearButton = document.querySelector('button[aria-label="Switch to Chinese (saved as default)"]');
    await click(bearButton);
    assert.ok(document.body.textContent.includes(ZH_TIP), 'Chinese tip after clicking bear');
    assert.equal(window.localStorage.getItem(LANG_KEY), 'zh', 'Chinese persisted as default');
    assert.ok(document.querySelector('button[aria-label="切换为英文（并设为默认语言）"]'), 'aria label flips to Chinese');

    // 再点一次：切回英文，偏好同步更新
    await click(document.querySelector('button[aria-label="切换为英文（并设为默认语言）"]'));
    assert.ok(document.body.textContent.includes(EN_TIP), 'English tip after second click');
    assert.equal(window.localStorage.getItem(LANG_KEY), 'en', 'English persisted as default');
  } finally {
    await act(async () => root.unmount());
  }
});

test('language pill toggles too and a remounted bear reads the persisted default', async () => {
  window.localStorage.removeItem(LANG_KEY);
  let root = await renderBear();
  try {
    const pill = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Tap for 中文'));
    assert.ok(pill, 'language pill rendered');
    await click(pill);
    assert.equal(window.localStorage.getItem(LANG_KEY), 'zh');
    assert.ok(document.body.textContent.includes(ZH_TIP));
  } finally {
    await act(async () => root.unmount());
  }

  // 重新挂载：未做任何操作即跟随持久化的中文默认值
  root = await renderBear();
  try {
    assert.ok(document.body.textContent.includes(ZH_TIP), 'remounted bear follows persisted Chinese default');
    assert.equal(window.localStorage.getItem(LANG_KEY), 'zh');
  } finally {
    await act(async () => root.unmount());
    window.localStorage.removeItem(LANG_KEY);
  }
});
