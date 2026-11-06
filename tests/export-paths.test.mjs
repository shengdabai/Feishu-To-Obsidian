import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { documentFileBase } from '../src/export-paths.mjs';

test('different documents with the same title cannot overwrite each other', () => {
  const a = documentFileBase('Meeting notes', 'https://example.feishu.cn/docx/one');
  const b = documentFileBase('Meeting notes', 'https://example.feishu.cn/docx/two');
  assert.notEqual(a, b);
});

test('the same document has stable output regardless of batch order or anchor', () => {
  assert.equal(documentFileBase('Notes', 'https://example.feishu.cn/docx/one#a'), documentFileBase('Notes', 'https://example.feishu.cn/docx/one#b'));
});

test('untrusted document titles remain a single filename', () => {
  const base = documentFileBase('../../x / \\ evil:*?"<>|', 'https://example.feishu.cn/docx/one');
  assert.equal(path.basename(base), base);
  assert.doesNotMatch(base, /[\\/<>:"|?*]/);
});

test('empty titles receive a usable name and distinct identities', () => {
  assert.match(documentFileBase('', 'https://example.feishu.cn/docx/one'), /^untitled - [a-f0-9]{16}$/);
});

test('title truncation preserves complete Unicode characters', () => {
  const base = documentFileBase('a' + '😀'.repeat(80), 'https://example.feishu.cn/docx/one');
  assert.equal(Buffer.from(base, 'utf8').toString('utf8'), base);
  assert.ok(base.startsWith('a😀'));
});

test('multibyte titles leave room for the identity and longest output extension', () => {
  for (const title of ['文'.repeat(100), '😀'.repeat(100), 'é'.repeat(100)]) {
    const base = documentFileBase(title, 'https://example.feishu.cn/docx/one');
    assert.ok(Buffer.byteLength(base + '.raw.txt', 'utf8') <= 255);
    assert.equal(Buffer.from(base, 'utf8').toString('utf8'), base);
    assert.match(base, / - [a-f0-9]{16}$/);
  }
});

test('ordinary titles keep the existing filename identity', () => {
  const base = documentFileBase('Meeting notes', 'https://example.feishu.cn/docx/one');
  assert.equal(base, 'Meeting notes - 49379018bd221b86');
});
