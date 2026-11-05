// 서버 비밀 열쇠(PEPPER)로 한 번 더 잠그기.
// 저장소(DB)만 유출되면 해커가 "답 확인 값"을 가져가 흔한 답을 제한 없이 맞혀 볼 수 있다.
// 그래서 답 확인 값은 서버만 아는 열쇠로 HMAC을 씌워 두고, 답을 맞혀야 받는 "잠긴 열쇠"도 그 열쇠로 한 번 더 잠근다.
// 그러면 DB와 PEPPER(Cloudflare 비밀 설정)를 둘 다 가져가야만 맞혀 보기를 시작할 수 있다.
//
// 'p1:'이 붙은 값이 잠근 값이고, 붙지 않은 값은 예전 값이다(scripts/pepper-migrate.mjs로 바꾼다).
// 워커와 바꾸기 스크립트(Node)가 같은 코드를 써서 같은 값을 만든다.
// PEPPER를 잃어버리면 모든 쪽지가 열리지 않는다. 따로 안전하게 보관할 것.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const P1 = 'p1:';

const cache = new Map();

async function keys(pepperHex) {
  if (!/^[0-9a-f]{64}$/.test(pepperHex || '')) throw new Error('PEPPER가 없거나 형식이 틀렸어요 (16진수 64자)');
  if (cache.has(pepperHex)) return cache.get(pepperHex);
  const raw = new Uint8Array(pepperHex.match(/../g).map((h) => parseInt(h, 16)));
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const derive = (info, alg, usages) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, alg, false, usages);
  const k = {
    hmac: await derive('findme.pepper.verifier', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    aes: await derive('findme.pepper.wrapped', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
  };
  cache.set(pepperHex, k);
  return k;
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// 답 확인 값 → 저장할 값
export async function sealVerifier(pepperHex, verifier) {
  const { hmac } = await keys(pepperHex);
  return P1 + toHex(await crypto.subtle.sign('HMAC', hmac, enc.encode(verifier)));
}

// 보낸 답(proof)이 저장된 값과 맞는지. 예전 값(p1: 없음)도 받아 준다
export async function verifierMatches(pepperHex, proof, stored, safeEqual) {
  if (typeof stored !== 'string') return false;
  if (!stored.startsWith(P1)) return safeEqual(proof, stored);
  return safeEqual(await sealVerifier(pepperHex, proof), stored);
}

// 잠긴 열쇠 → 저장할 값
export async function sealWrapped(pepperHex, wrapped) {
  const { aes } = await keys(pepperHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(wrapped)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return P1 + toB64(out);
}

// 저장된 값 → 원래의 잠긴 열쇠 (예전 값은 그대로)
export async function openWrapped(pepperHex, stored) {
  if (!stored.startsWith(P1)) return stored;
  const { aes } = await keys(pepperHex);
  const raw = fromB64(stored.slice(P1.length));
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, aes, raw.slice(12)));
}
