import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { expandVisibleControls, parseDocumentLinks, validateDocumentUrl } from '../src/page-safety.mjs';

test('document links accept HTTPS Feishu/Lark and reject unsafe origins without leaking input', () => {
  for (const value of ['https://example.feishu.cn/wiki/a#b', 'https://example.larksuite.com/docx/a']) {
    assert.equal(validateDocumentUrl(value), value);
  }
  for (const value of [
    'file:///tmp/private', 'javascript:alert(1)', 'http://example.feishu.cn/wiki/a',
    'https://example.feishu.cn.attacker.test/a', 'https://evilfeishu.cn/a',
    'https://example.feishu.cn:8443/a', 'https://user:private@example.feishu.cn/a',
    'https://example.feishu.cn@attacker.test/a', 'https://127.0.0.1/a', 'private',
  ]) {
    assert.throws(() => validateDocumentUrl(value));
    assert.throws(() => parseDocumentLinks(`# comment\n\n${value}`), {
      message: 'links.txt 第 3 行不是受支持的 HTTPS 飞书/Lark 链接。',
    });
  }
  assert.deepEqual(parseDocumentLinks('# comment\r\nhttps://example.feishu.cn/a\n https://example.feishu.cn/a '),
    ['https://example.feishu.cn/a']);
  assert.throws(() => parseDocumentLinks('# empty\n'));
});

function fixture() {
  const clicks = [];
  const element = (name, text, { blocked = false, nested = false, children = false, hidden = false, form = null } = {}) => ({
    textContent: text, hidden, form, tagName: 'BUTTON',
    closest: selector => selector.startsWith('a,') ? blocked : nested ? {} : null,
    querySelector: () => children ? {} : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => clicks.push(name),
  });
  const controls = [
    element('expand', '  展开更多 '), element('container', '这是更多正文'),
    element('navigation', '查看更多', { blocked: true }),
    element('submit', 'More', { blocked: true }),
    element('external-form', 'More', { form: {} }),
    element('nested', '展开', { nested: true }),
    element('parent', '展开', { children: true }),
    element('hidden', '展开', { hidden: true }),
  ];
  const body = { innerText: 'Fixture\n正文', scrollHeight: 1000, clientHeight: 1000, scrollTop: 0 };
  const document = {
    body, documentElement: body, scrollingElement: body, title: 'Fixture',
    querySelector: () => body,
    querySelectorAll: selector => selector === 'div, main, section' || selector === 'h1' ? [] : controls,
  };
  const window = {
    getComputedStyle: element => ({ visibility: element.hidden ? 'hidden' : 'visible', display: 'block' }),
    setTimeout: fn => { fn(); }, scrollTo: () => {},
  };
  return { clicks, document, window };
}

test('batch expansion clicks exact labels and excludes links, forms, containers and duplicate nested controls', () => {
  const { clicks, document, window } = fixture();
  vm.runInNewContext(`(${expandVisibleControls.toString()})(['展开更多', '查看更多', '展开', 'More'])`, { document, window });
  assert.deepEqual(clicks, ['expand']);
});

test('extension extraction applies the same safe expansion policy', async () => {
  const { clicks, document, window } = fixture();
  const source = await fs.readFile(new URL('../browser-extension/background.js', import.meta.url), 'utf8');
  const result = await vm.runInNewContext(`${source}\nextractFeishuPage()`, {
    document, window, URL, location: { href: 'https://example.feishu.cn/docx/a' },
    chrome: { action: { onClicked: { addListener: () => {} } } },
  });
  assert.equal(result.success, true);
  assert.ok(clicks.length > 0);
  assert.ok(clicks.every(name => name === 'expand'));
  assert.match(result.rawText, /正文/);
});
