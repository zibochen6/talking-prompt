import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLatestRelease } from '../desktop/updates.ts';
const response = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
test('只对正式且更新的版本展示固定 GitHub 地址', async () => {
  assert.deepEqual(await checkLatestRelease('1.0.0', response({ tag_name: 'v1.2.0', html_url: 'https://evil.invalid' })), { kind: 'available', version: '1.2.0', url: 'https://github.com/zibochen6/talking-prompt/releases/tag/v1.2.0' });
  assert.deepEqual(await checkLatestRelease('1.2.0', response({ tag_name: 'v1.2.0' })), { kind: 'current' });
  assert.deepEqual(await checkLatestRelease('1.2.0', response({ tag_name: 'v1.1.0' })), { kind: 'current' });
  assert.deepEqual(await checkLatestRelease('1.0.0', response({}, 404)), { kind: 'current' });
});
test('网络故障、非法版本和预发布不会被误认成可安装更新', async () => {
  assert.deepEqual(await checkLatestRelease('1.0.0', (async () => { throw new Error('offline'); }) as typeof fetch), { kind: 'error' });
  assert.deepEqual(await checkLatestRelease('1.0.0', response({}, 500)), { kind: 'error' });
  assert.deepEqual(await checkLatestRelease('1.0.0', response({ tag_name: 'v2.0.0', prerelease: true })), { kind: 'error' });
  assert.deepEqual(await checkLatestRelease('1.0.0', response({ tag_name: 'not-a-version' })), { kind: 'error' });
});
