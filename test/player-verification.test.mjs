import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetForTests, verifyPlayer } from '../lib/player-verification.mjs';

function response(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

test('provider 1 success is normalized', async () => {
  __resetForTests({ fetchImpl: async () => response({ basicInfo: { accountId: '12345678', nickname: 'Alpha', level: 12 } }) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'VALID');
  assert.equal(result.nickname, 'Alpha');
  assert.equal(result.provider, 'nftoken');
});

test('provider 1 failure falls through to provider 2', async () => {
  __resetForTests({ fetchImpl: async url => url.includes('nftoken') ? response({}, 503) : response({ player: { accountId: '12345678', nickname: 'Bravo' } }) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'VALID');
  assert.equal(result.nickname, 'Bravo');
  assert.equal(result.provider, 'glob-info');
});

test('provider 1 and 2 failure falls through to configured provider 3', async () => {
  __resetForTests({ freeFireApiKey: 'test-key', fetchImpl: async url => url.includes('freefirecommunity') ? response({ basicInfo: { accountId: '12345678', nickname: 'Charlie' } }) : response({}, 503) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'VALID');
  assert.equal(result.nickname, 'Charlie');
  assert.equal(result.provider, 'free-fire-api');
});

test('malformed and unavailable providers return UNKNOWN, never INVALID', async () => {
  __resetForTests({ freeFireApiKey: 'test-key', fetchImpl: async () => ({ status: 200, ok: true, text: async () => '{' }) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'UNKNOWN');
});

test('explicit not-found response is INVALID', async () => {
  __resetForTests({ fetchImpl: async () => response({ code: 'RES_001' }) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'INVALID');
});

test('simultaneous lookups share one request and cache hits are marked', async () => {
  let calls = 0;
  __resetForTests({ fetchImpl: async () => { calls++; await new Promise(r => setTimeout(r, 20)); return response({ basicInfo: { accountId: '12345678', nickname: 'Delta' } }); } });
  const [first, second] = await Promise.all([verifyPlayer({ uid: '12345678' }), verifyPlayer({ uid: '12345678' })]);
  assert.equal(first.nickname, 'Delta');
  assert.equal(second.nickname, 'Delta');
  assert.equal(calls, 1);
  const cached = await verifyPlayer({ uid: '12345678' });
  assert.equal(cached.cached, true);
});

test('wrong account ID is rejected as UNKNOWN', async () => {
  __resetForTests({ freeFireApiKey: 'test-key', retryDelayMs: 0, fetchImpl: async () => response({ basicInfo: { accountId: '87654321', nickname: 'Wrong' } }) });
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'UNKNOWN');
});

test('expired valid cache is served stale when providers are down', async () => {
  let healthy = true;
  __resetForTests({ successTtlMs: 1, staleTtlMs: 1000, retryDelayMs: 0, fetchImpl: async () => healthy ? response({ basicInfo: { accountId: '12345678', nickname: 'Cached' } }) : response({}, 503) });
  await verifyPlayer({ uid: '12345678' });
  await new Promise(r => setTimeout(r, 5));
  healthy = false;
  const result = await verifyPlayer({ uid: '12345678' });
  assert.equal(result.status, 'VALID');
  assert.match(result.message, /Previously verified/);
});

test('circuit breaker opens and later allows recovery', async () => {
  let healthy = false;
  __resetForTests({ circuitFailures: 1, circuitOpenMs: 15, retryDelayMs: 0, fetchImpl: async () => healthy ? response({ basicInfo: { accountId: '12345678', nickname: 'Recovered' } }) : response({}, 503) });
  assert.equal((await verifyPlayer({ uid: '12345678' })).status, 'UNKNOWN');
  healthy = true;
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await verifyPlayer({ uid: '12345678' })).nickname, 'Recovered');
});

test('concurrency limit returns UNKNOWN instead of overloading providers', async () => {
  __resetForTests({ maxConcurrent: 1, retryDelayMs: 0, fetchImpl: async () => { await new Promise(r => setTimeout(r, 30)); return response({ basicInfo: { accountId: '12345678', nickname: 'Busy' } }); } });
  const first = verifyPlayer({ uid: '12345678' });
  const second = await verifyPlayer({ uid: '87654321' });
  assert.equal(second.status, 'UNKNOWN');
  await first;
});
