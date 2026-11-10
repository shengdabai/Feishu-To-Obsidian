import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../browser-extension/background.js', import.meta.url), 'utf8');

function extension() {
  const downloads = [];
  const injections = [];
  let onClick;
  const context = vm.createContext({
    TextEncoder, btoa, setTimeout: () => 0,
    chrome: {
      action: {
        onClicked: { addListener: fn => { onClick = fn; } },
        setBadgeBackgroundColor: async () => { if (context.failBadges) throw new Error('Tab closed'); },
        setBadgeText: async () => {},
        setTitle: async () => {},
      },
      scripting: { executeScript: async options => { injections.push(options); return [{ result: {
        success: true, title: context.fixtureTitle, markdown: '# Fixture 😀', rawText: 'Fixture 中文',
      } }]; } },
      downloads: { download: async options => { downloads.push(options); } },
    },
    URL,
  });
  vm.runInContext(source, context);
  return { context, downloads, injections, onClick };
}

test('extension rejects unsupported protocols, credentials, ports and deceptive hosts before injection', async () => {
  for (const url of ['http://example.feishu.cn/a', 'file:///tmp/private',
    'https://example.feishu.cn.attacker.test/a', 'https://u:p@example.feishu.cn/a',
    'https://example.feishu.cn:8443/a']) {
    const { downloads, injections, onClick } = extension();
    await onClick({ id: 1, url });
    assert.equal(injections.length, 0);
    assert.equal(downloads.length, 0);
  }
});

test('injected extractor rechecks the actual origin after a tab navigation race', async () => {
  const { context } = extension();
  context.location = { href: 'https://attacker.test/a' };
  const result = await vm.runInContext('extractFeishuPage()', context);
  assert.equal(result.success, false);
  assert.match(result.error, /HTTPS/);
});

test('a closed tab during badge updates does not reject the click handler', async () => {
  const { context, downloads, onClick } = extension();
  context.failBadges = true;
  await assert.doesNotReject(() => onClick({ id: 1, url: 'https://example.feishu.cn/a' }));
  assert.equal(downloads.length, 0);
});

test('extension needs only user-activated access to the current tab', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../browser-extension/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.permissions, ['activeTab', 'downloads', 'scripting']);
  assert.equal(manifest.host_permissions, undefined);
});

test('extension download names preserve emoji and fit the filename byte limit', async () => {
  for (const title of ['a' + '😀'.repeat(80), '😀'.repeat(100), '文'.repeat(100)]) {
    const { context, downloads, onClick } = extension();
    context.fixtureTitle = title;
    await onClick({ id: 1, url: 'https://example.feishu.cn/docx/fixture' });
    assert.equal(downloads.length, 2);
    for (const { filename, url } of downloads) {
      const base = filename.split('/').at(-1);
      assert.equal(Buffer.from(base).toString('utf8'), base);
      assert.ok(Buffer.byteLength(base) <= 255, 'filename must fit on disk');
      assert.match(url, /^data:text\/(?:markdown|plain);charset=utf-8;base64,/);
    }
    assert.equal(Buffer.from(downloads[0].url.split(',')[1], 'base64').toString(), '# Fixture 😀');
    assert.equal(Buffer.from(downloads[1].url.split(',')[1], 'base64').toString(), 'Fixture 中文');
  }
});

test('extension keeps ordinary filenames and removes unsafe path separators', () => {
  const { context } = extension();
  assert.equal(vm.runInContext('slugify("Meeting notes")', context), 'Meeting notes');
  context.fixtureTitle = '../\\folder/:*?"<>|';
  const name = vm.runInContext('slugify(fixtureTitle)', context);
  assert.doesNotMatch(name, /[\\/<>:"|?*]/);
  assert.equal(vm.runInContext('slugify("   ")', context), 'untitled');
});

test('extension download names fit the byte limit after uniquify adds a suffix', async () => {
  for (const title of ['😀'.repeat(61) + 'abc', '文'.repeat(100), 'a' + '😀'.repeat(100)]) {
    const { context, downloads, onClick } = extension();
    context.fixtureTitle = title;
    await onClick({ id: 1, url: 'https://example.feishu.cn/docx/fixture' });
    assert.equal(downloads.length, 2);
    for (const { filename, conflictAction } of downloads) {
      assert.equal(conflictAction, 'uniquify');
      const base = filename.split('/').at(-1);
      const extensionIndex = base.lastIndexOf('.');
      for (const suffix of [' (1)', ' (10)', ' (999)', ' (9999999999999)']) {
        const uniqueName = base.slice(0, extensionIndex) + suffix + base.slice(extensionIndex);
        assert.ok(Buffer.byteLength(uniqueName) <= 255, 'uniquified filename must fit on disk');
      }
    }
  }
});

test('slugify preserves complete graphemes at the title length limit', () => {
  const { context } = extension();
  for (const grapheme of ['👨‍👩‍👧‍👦', '👩🏽‍💻', '🇨🇳', 'x\u0301']) {
    context.fixtureTitle = 'a'.repeat(79) + grapheme + 'z';
    assert.equal(vm.runInContext('slugify(fixtureTitle)', context), 'a'.repeat(79) + grapheme);
  }
});

test('slugify stops before a grapheme that would exceed the byte budget', () => {
  const { context } = extension();
  for (const grapheme of ['👨‍👩‍👧‍👦', '👩🏽‍💻', '🇨🇳', 'x\u0301']) {
    const prefix = '😀'.repeat(57) + 'ab';
    context.fixtureTitle = prefix + grapheme;
    assert.equal(vm.runInContext('slugify(fixtureTitle)', context), prefix);
  }
});
