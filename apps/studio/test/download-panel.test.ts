import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL('../src/download-panel.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
const module = { exports: {} as any };
new Function('require', 'module', 'exports', compiled)((name: string) => name === './api.ts' ? {} : require(name), module, module.exports);
test('viewer download explains restriction and associates the disabled button with its reason', () => {
  const html = renderToStaticMarkup(createElement(module.exports.DownloadPanel, { projectId: 'p', apiIds: ['customers'], disabled: true }));
  assert.ok(html.includes(module.exports.VIEWER_DOWNLOAD_NOTICE));
  const describedBy = /<button aria-describedby="([^"]+)" disabled=""/.exec(html)?.[1];
  assert.ok(describedBy); assert.ok(html.includes(`<p id="${describedBy}">${module.exports.VIEWER_DOWNLOAD_NOTICE}</p>`));
});
test('editor download explains eligible roles without viewer restriction', () => {
  const html = renderToStaticMarkup(createElement(module.exports.DownloadPanel, { projectId: 'p', apiIds: ['customers'], disabled: false }));
  assert.ok(html.includes('편집자·소유자는 사유를 입력해')); assert.ok(!html.includes('aria-describedby'));
});
