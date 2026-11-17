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
const temporary = path.join(frontend, '.cache', 'cv-images-test');
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gallerySource = await readFile(
  path.join(frontend, 'components/CvImageGallery.tsx'),
  'utf8',
);
const galleryCode = ts.transpileModule(gallerySource, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const galleryPath = path.join(temporary, 'gallery.mjs');
await writeFile(galleryPath, galleryCode);
const { default: CvImageGallery } = await import(pathToFileURL(galleryPath).href);

const images = [
  { url: '/api/uploads/upl_1/cv-images/cv_img_001.jpeg', filename: 'cv_img_001.jpeg' },
  { url: '/api/uploads/upl_1/cv-images/cv_img_002.png', filename: 'cv_img_002.png' },
];

const render = async (props) => {
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(CvImageGallery, props)));
  return root;
};

test('renders nothing when there are no CV images', async () => {
  const root = await render({ images: [] });
  try {
    assert.equal(document.body.textContent, '');
    assert.equal(document.querySelectorAll('img').length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test('renders thumbnails and opens/closes the lightbox', async () => {
  const root = await render({ images });
  try {
    const thumbs = document.querySelectorAll('button[aria-label^="View CV image"]');
    assert.equal(thumbs.length, 2);
    assert.equal(document.querySelectorAll('img[alt="CV image 1"]').length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);

    // 点击第一张缩略图 → 灯箱打开且显示对应原图
    await act(async () =>
      thumbs[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'lightbox dialog opens');
    assert.ok(dialog.querySelector('img').getAttribute('src').includes('cv_img_001'));

    // 下一张按钮切换到第二张
    const next = document.querySelector('button[aria-label="Next image"]');
    await act(async () =>
      next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    assert.ok(document.querySelector('[role="dialog"] img').getAttribute('src').includes('cv_img_002'));

    // ESC 关闭灯箱
    await act(async () =>
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('an image that fails to load is removed from the gallery', async () => {
  const root = await render({ images });
  try {
    assert.equal(document.querySelectorAll('button[aria-label^="View CV image"]').length, 2);
    const firstImg = document.querySelector('img[alt="CV image 1"]');
    await act(async () =>
      firstImg.dispatchEvent(new dom.window.Event('error', { bubbles: true })),
    );
    const remaining = document.querySelectorAll('button[aria-label^="View CV image"]');
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0].getAttribute('aria-label').includes('2 of 2'));
  } finally {
    await act(async () => root.unmount());
  }
});
