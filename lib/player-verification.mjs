const DEFAULTS = {
  timeoutMs: 4500,
  globalDeadlineMs: 10000,
  retryDelayMs: 120,
  successTtlMs: 10 * 60 * 1000,
  invalidTtlMs: 60 * 1000,
  staleTtlMs: 24 * 60 * 60 * 1000,
  circuitFailures: 3,
  circuitOpenMs: 30 * 1000,
  providerRateMs: 250,
  maxConcurrent: 8,
};

const providers = new Map();
const cache = new Map();
const inflight = new Map();
let activeLookups = 0;

function createProvider(name, lookup) {
  return { name, lookup, state: 'CLOSED', failures: 0, openedAt: 0, halfOpenInFlight: false,
    successCount: 0, failureCount: 0, rateLimitCount: 0, totalLatencyMs: 0,
    lastSuccess: null, lastFailure: null, lastRequestAt: 0 };
}

export function configureProviders({ freeFireApiKey = process.env.FREE_FIRE_API_KEY, fetchImpl = globalThis.fetch, ...options } = {}) {
  providers.clear();
  providers.set('nftoken', createProvider('nftoken', (uid, ctx) => requestNftoken(uid, ctx)));
  providers.set('glob-info', createProvider('glob-info', (uid, ctx) => requestGlobInfo(uid, ctx)));
  if (freeFireApiKey) providers.set('free-fire-api', createProvider('free-fire-api', (uid, ctx) => requestFreeFire(uid, ctx)));
  settings = { ...DEFAULTS, ...options, fetchImpl, freeFireApiKey };
  return providers;
}

let settings = { ...DEFAULTS, fetchImpl: globalThis.fetch, freeFireApiKey: '' };
configureProviders();

function base(status, uid, message, extra = {}) {
  return { status, uid, nickname: null, region: null, level: null, provider: null, cached: false, message, ...extra };
}

function normalizeUid(uid) { return String(uid || '').replace(/\D/g, ''); }
function cacheKey(uid, region) { return `${normalizeUid(uid)}:${String(region || 'ind').toLowerCase()}`; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null; }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

function profileFrom(data, uid, region) {
  const candidates = [data?.basicInfo, data?.data?.basicInfo, data?.player, data?.data?.player, data?.data, data].filter(Boolean);
  for (const info of candidates) {
    const accountId = String(info.accountId ?? info.accountID ?? info.uid ?? info.userId ?? '');
    if (accountId && accountId !== uid) continue;
    const nickname = text(info.nickname ?? info.name ?? info.username ?? info.player?.nickname);
    const level = number(info.level ?? info.playerLevel);
    if (accountId === uid || nickname) return { nickname, region: text(info.region ?? region), level, accountId };
  }
  return null;
}

function explicitInvalid(data) {
  const code = String(data?.code ?? data?.errorCode ?? data?.status ?? '').toUpperCase();
  const message = String(data?.message ?? data?.error ?? '').toLowerCase();
  return code === 'RES_001' || code === 'NOT_FOUND' || code === 'INVALID_UID' || /not found|does not exist|invalid uid/.test(message);
}

async function fetchJson(url, headers = {}) {
  const response = await settings.fetchImpl(url, { headers, signal: AbortSignal.timeout(settings.timeoutMs) });
  const raw = await response.text();
  if (raw.length > 200_000) throw new Error('response_too_large');
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('malformed_json'); }
  return { response, data };
}

async function requestNftoken(uid, { region }) {
  // The documented checkbanned route is currently 404; this provider's live
  // profile route returns accountId and basicInfo and is safer for verification.
  const { response, data } = await fetchJson(`https://api2.nftoken.info/player-info?uid=${encodeURIComponent(uid)}&region=${encodeURIComponent(region)}`);
  if (!response.ok) throw new Error(response.status === 429 ? 'rate_limited' : `http_${response.status}`);
  if (explicitInvalid(data)) return { status: 'INVALID', message: 'Provider confirmed the UID does not exist.' };
  const profile = profileFrom(data, uid, 'ind');
  if (!profile?.accountId) throw new Error('unexpected_schema');
  return { status: 'VALID', ...profile, message: 'UID verified.' };
}

async function requestGlobInfo(uid) {
  const { response, data } = await fetchJson(`https://glob-info2.vercel.app/info?uid=${encodeURIComponent(uid)}`);
  if (!response.ok) throw new Error(response.status === 429 ? 'rate_limited' : `http_${response.status}`);
  if (explicitInvalid(data)) return { status: 'INVALID', message: 'Provider confirmed the UID does not exist.' };
  const profile = profileFrom(data, uid, 'ind');
  if (!profile?.accountId) throw new Error('unexpected_schema');
  return { status: 'VALID', ...profile, message: 'UID verified.' };
}

async function requestFreeFire(uid, { region }) {
  const { response, data } = await fetchJson(`https://developers.freefirecommunity.com/api/v1/info?region=${encodeURIComponent(region)}&uid=${encodeURIComponent(uid)}`, { 'x-api-key': settings.freeFireApiKey });
  if (response.status === 404 || explicitInvalid(data)) return { status: 'INVALID', message: 'Provider confirmed the UID does not exist.' };
  if (!response.ok) throw new Error(response.status === 429 ? 'rate_limited' : `http_${response.status}`);
  const profile = profileFrom(data, uid, region);
  if (!profile?.accountId || profile.accountId !== uid) throw new Error('unexpected_schema');
  return { status: 'VALID', ...profile, message: 'UID verified.' };
}

function canUse(provider, now) {
  if (provider.state === 'CLOSED') return true;
  if (provider.state === 'OPEN' && now - provider.openedAt >= settings.circuitOpenMs) {
    if (!provider.halfOpenInFlight) { provider.state = 'HALF_OPEN'; provider.halfOpenInFlight = true; return true; }
  }
  return provider.state === 'HALF_OPEN' && !provider.halfOpenInFlight;
}

async function waitRate(provider) {
  const delay = Math.max(0, provider.lastRequestAt + settings.providerRateMs - Date.now());
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  provider.lastRequestAt = Date.now();
}

function recordSuccess(provider, latency) {
  provider.state = 'CLOSED'; provider.halfOpenInFlight = false; provider.failures = 0;
  provider.successCount++; provider.totalLatencyMs += latency; provider.lastSuccess = new Date().toISOString();
}
function recordFailure(provider, error) {
  provider.halfOpenInFlight = false; provider.failures++; provider.failureCount++;
  if (error.message === 'rate_limited') provider.rateLimitCount++;
  provider.lastFailure = new Date().toISOString();
  if (provider.failures >= settings.circuitFailures) { provider.state = 'OPEN'; provider.openedAt = Date.now(); }
}

async function callProvider(provider, uid, region, deadline) {
  if (!canUse(provider, Date.now())) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() >= deadline) return null;
    await waitRate(provider);
    const started = Date.now();
    try {
      const result = await provider.lookup(uid, { region });
      if (!result || !['VALID', 'INVALID'].includes(result.status)) throw new Error('unusable_result');
      recordSuccess(provider, Date.now() - started);
      return { ...base(result.status, uid, result.message), ...result, provider: provider.name };
    } catch (error) {
      const transient = ['provider_unavailable', 'rate_limited', 'malformed_json', 'unexpected_schema', 'unusable_result'].includes(error.message) || error.name === 'TimeoutError' || error.name === 'AbortError';
      recordFailure(provider, error);
      if (!transient || attempt === 1) return null;
      const backoff = settings.retryDelayMs * (2 ** attempt) + Math.floor(Math.random() * 80);
      if (Date.now() + backoff >= deadline) return null;
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}

async function lookupInternal(uid, region) {
  const key = cacheKey(uid, region);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return { ...cached.value, cached: true };
  const deadline = now + settings.globalDeadlineMs;
  for (const provider of providers.values()) {
    if (Date.now() >= deadline) break;
    const result = await callProvider(provider, uid, region, deadline);
    if (!result) continue;
    const ttl = result.status === 'VALID' ? settings.successTtlMs : settings.invalidTtlMs;
    cache.set(key, { value: result, expiresAt: Date.now() + ttl, staleUntil: Date.now() + settings.staleTtlMs });
    return result;
  }
  if (cached && cached.value.status === 'VALID' && cached.staleUntil > Date.now()) return { ...cached.value, cached: true, message: 'Previously verified profile; live verification is temporarily unavailable.' };
  return base('UNKNOWN', uid, 'Player verification temporarily unavailable. Please retry.');
}

export async function verifyPlayer({ uid, region = 'ind' } = {}) {
  const normalized = normalizeUid(uid);
  if (!/^\d{8,12}$/.test(normalized)) return base('INVALID', normalized, 'UID must contain 8–12 digits.');
  const key = cacheKey(normalized, region);
  if (inflight.has(key)) return inflight.get(key);
  if (activeLookups >= settings.maxConcurrent) return base('UNKNOWN', normalized, 'Player verification is busy. Please retry.');
  activeLookups++;
  const promise = lookupInternal(normalized, region).finally(() => { activeLookups--; inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}

export function invalidatePlayerCache(uid, region = 'ind') { cache.delete(cacheKey(uid, region)); }

export function healthSnapshot() {
  return [...providers.values()].map(p => ({ name: p.name, state: p.state, failures: p.failures, successCount: p.successCount, failureCount: p.failureCount, rateLimitCount: p.rateLimitCount, averageLatencyMs: p.successCount ? Math.round(p.totalLatencyMs / p.successCount) : null, lastSuccess: p.lastSuccess, lastFailure: p.lastFailure }));
}

export function __resetForTests(options = {}) {
  cache.clear(); inflight.clear(); activeLookups = 0; configureProviders(options);
}
