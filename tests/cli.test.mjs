import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function cliFixture(t, links, scenario) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'src'));
  for (const name of ['index.mjs', 'export-paths.mjs', 'page-safety.mjs']) {
    await fs.copyFile(path.join(root, 'src', name), path.join(dir, 'src', name));
  }
  await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  await fs.writeFile(path.join(dir, 'links.txt'), links);
  await fs.writeFile(path.join(dir, 'loader.mjs'), `
    export async function resolve(specifier, context, next) {
      if (specifier === 'playwright') return { url: new URL('./browser.mjs', import.meta.url).href, shortCircuit: true };
      return next(specifier, context);
    }
  `);
  await fs.writeFile(path.join(dir, 'browser.mjs'), `
    import fs from 'node:fs/promises';
    export const chromium = { launchPersistentContext: async () => ({
      pages: () => [],
      newPage: async () => {
        if (${JSON.stringify(scenario)} === 'new-page-failure') throw new Error('Fixture newPage failure');
        return { goto: async () => {}, url: () => 'https://attacker.test/redirect' };
      },
      close: () => fs.writeFile(new URL('./closed', import.meta.url), 'closed'),
    }) };
  `);
  const result = spawnSync(process.execPath, ['--loader', path.join(dir, 'loader.mjs'), path.join(dir, 'src/index.mjs')], {
    cwd: dir, input: '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined);
  return { dir, result };
}

test('invalid links stop the CLI before creating output or a browser profile', async t => {
  const { dir, result } = await cliFixture(t, 'file:///tmp/private', 'unused');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /第 1 行/);
  await assert.rejects(fs.access(path.join(dir, 'output')));
  await assert.rejects(fs.access(path.join(dir, 'browser-profile')));
});

test('a failed newPage still closes the persistent browser context', async t => {
  const { dir, result } = await cliFixture(t, 'https://example.feishu.cn/docx/a', 'new-page-failure');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Fixture newPage failure/);
  assert.equal(await fs.readFile(path.join(dir, 'closed'), 'utf8'), 'closed');
});

test('an off-site redirect produces a failed manifest and a nonzero exit status', async t => {
  const { dir, result } = await cliFixture(t, 'https://example.feishu.cn/docx/a', 'redirect');
  assert.equal(result.status, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'output', 'manifest.json'), 'utf8'));
  assert.equal(manifest[0].status, 'failed');
  assert.match(manifest[0].error, /HTTPS/);
  assert.equal(await fs.readFile(path.join(dir, 'closed'), 'utf8'), 'closed');
});
