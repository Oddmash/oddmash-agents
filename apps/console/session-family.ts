import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_LIFETIME_MS = 5 * 60_000;
export const SESSION_LIFETIME_MS = 8 * 60 * 60_000;
export const REFRESH_WINDOW_MS = 30_000;
export const CONCURRENT_REFRESH_MS = 5_000;
export const MAX_ACTIVE_FAMILIES = 8;
export const MAX_RETAINED_FAMILIES = 32;
const MAX_SPENT = 128;

type SpentRefresh = { digest: string; replacedAt: number };
export type SessionFamily = { id: string; bootstrapDigest: string; ownerId: string; issuedAt: number; expiresAt: number; accessExpiresAt: number; accessDigest: string; refreshDigest: string; spent: SpentRefresh[]; revoked: boolean };
export type SessionState = { families: SessionFamily[] };
export type SessionCredentials = { access: string; refresh: string; accessExpiresAt: number; expiresAt: number };
type Transition = { state: SessionState; outcome: 'issued' | 'rotated'; credentials: SessionCredentials } | { state: SessionState; outcome: 'authorized' | 'revoked' | 'conflict' | 'denied' | 'capacity' | 'too-early' };
const hex = /^[a-f0-9]{64}$/;
const identity = /^[1-9]\d*$/;
const token = /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/;
const tokenId = (value: string) => token.test(value) ? value.slice(0, 32) : undefined;
const digest = (key: string, purpose: string, value: string) => createHmac('sha256', key).update(purpose).update('\0').update(value).digest('hex');
const matches = (a: string, b: string) => hex.test(a) && hex.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const secret = (id: string) => id + '.' + randomBytes(32).toString('base64url');
const prune = (state: SessionState, now: number): SessionState => ({ families: state.families.filter(family => family.expiresAt > now) });
const replace = (state: SessionState, family: SessionFamily): SessionState => ({ families: state.families.map(current => current.id === family.id ? family : current) });
const denied = (state: SessionState): Transition => ({ state, outcome: 'denied' });

export function issueSession(state: SessionState, ownerId: string, expectedOwner: string, bootstrap: string, signedInAt: number, now: number, key: string): Transition {
  const current = prune(state, now);
  if (!identity.test(ownerId) || ownerId !== expectedOwner || !/^[A-Za-z0-9_-]{43}$/.test(bootstrap) || !Number.isSafeInteger(signedInAt) || signedInAt > now || now - signedInAt >= SESSION_LIFETIME_MS || !key) return denied(current);
  const bootstrapDigest = digest(key, 'bootstrap', bootstrap);
  if (current.families.some(family => matches(family.bootstrapDigest, bootstrapDigest))) return denied(current);
  if (current.families.length >= MAX_RETAINED_FAMILIES || current.families.filter(family => !family.revoked).length >= MAX_ACTIVE_FAMILIES) return { state: current, outcome: 'capacity' };
  const id = randomBytes(16).toString('hex');
  const access = secret(id), refresh = secret(id);
  const expiresAt = signedInAt + SESSION_LIFETIME_MS;
  const accessExpiresAt = Math.min(now + ACCESS_LIFETIME_MS, expiresAt);
  const family: SessionFamily = { id, bootstrapDigest, ownerId, issuedAt: signedInAt, expiresAt, accessExpiresAt, accessDigest: digest(key, 'access', access), refreshDigest: digest(key, 'refresh', refresh), spent: [], revoked: false };
  return { state: { families: [...current.families, family] }, outcome: 'issued', credentials: { access, refresh, accessExpiresAt, expiresAt } };
}

export function authorizeSession(state: SessionState, access: string, expectedOwner: string, now: number, key: string): boolean {
  const id = tokenId(access);
  const family = id && state.families.find(entry => entry.id === id);
  return Boolean(family && key && !family.revoked && family.ownerId === expectedOwner && family.expiresAt > now && family.accessExpiresAt > now && matches(family.accessDigest, digest(key, 'access', access)));
}

export function rotateSession(state: SessionState, refresh: string, expectedOwner: string, now: number, key: string): Transition {
  const current = prune(state, now);
  const id = tokenId(refresh);
  const family = id && current.families.find(entry => entry.id === id);
  if (!family || !key || family.revoked || family.ownerId !== expectedOwner) return denied(current);
  const candidate = digest(key, 'refresh', refresh);
  if (!matches(family.refreshDigest, candidate)) {
    const previous = family.spent.find(entry => matches(entry.digest, candidate));
    if (!previous) return denied(current);
    if (now - previous.replacedAt <= CONCURRENT_REFRESH_MS) return { state: current, outcome: 'conflict' };
    return { state: replace(current, { ...family, revoked: true }), outcome: 'revoked' };
  }
  if (family.accessExpiresAt - now > REFRESH_WINDOW_MS) return { state: current, outcome: 'too-early' };
  if (family.spent.length >= MAX_SPENT) return { state: replace(current, { ...family, revoked: true }), outcome: 'revoked' };
  const access = secret(family.id), nextRefresh = secret(family.id);
  const accessExpiresAt = Math.min(now + ACCESS_LIFETIME_MS, family.expiresAt);
  const updated = { ...family, accessExpiresAt, accessDigest: digest(key, 'access', access), refreshDigest: digest(key, 'refresh', nextRefresh), spent: [...family.spent, { digest: family.refreshDigest, replacedAt: now }] };
  return { state: replace(current, updated), outcome: 'rotated', credentials: { access, refresh: nextRefresh, accessExpiresAt, expiresAt: family.expiresAt } };
}

export function revokeSession(state: SessionState, credential: string, expectedOwner: string, now: number, key: string): Transition {
  const current = prune(state, now);
  const id = tokenId(credential);
  const family = id && current.families.find(entry => entry.id === id);
  if (!family || !key || family.ownerId !== expectedOwner) return denied(current);
  const refreshDigest = digest(key, 'refresh', credential);
  if (!(matches(family.accessDigest, digest(key, 'access', credential)) || matches(family.refreshDigest, refreshDigest) || family.spent.some(entry => matches(entry.digest, refreshDigest)))) return denied(current);
  return { state: replace(current, { ...family, revoked: true }), outcome: 'revoked' };
}
