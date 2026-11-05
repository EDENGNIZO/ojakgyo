// 모든 암호화는 이 파일에서, 사용자 브라우저 안에서만 일어난다.
// 서버에는 출입문 ID(해시), 암호문, 검증값만 전달된다.

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = crypto.subtle;

const ITER_DOOR = 100_000; // 출입문(이름+생일) 계산 비용
const ITER_QUIZ = 200_000; // 퀴즈 정답 계산 비용
const DOOR_SALT = te.encode('findme.v1.door');

export const POW_PREFIX = '0000';

export function rand(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256hex(input) {
  const data = typeof input === 'string' ? te.encode(input) : input;
  return hex(new Uint8Array(await subtle.digest('SHA-256', data)));
}

async function pbkdf2(secret, salt, iterations) {
  const key = await subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hkdf(ikm, info) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function aes(raw) {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(keyBytes, obj) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await aes(keyBytes), te.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64u.enc(out);
}

// 열쇠가 틀리거나 누가 위조한 암호문이면 null (AES-GCM이 위변조를 검출한다)
export async function open(keyBytes, str) {
  try {
    const raw = b64u.dec(str);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aes(keyBytes), raw.slice(12));
    return JSON.parse(td.decode(pt));
  } catch {
    return null;
  }
}

// ---------- 정규화: 같은 사람이 조금 다르게 입력해도 같은 값이 되도록 ----------

export function normName(s) {
  return (s || '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

// '1995.3.14', '1995-03-14', '19950314' → '19950314'
export function normDate(s) {
  const t = (s || '').trim();
  let y, m, d;
  const parts = t.split(/[.\-/\s]+/).filter(Boolean);
  if (parts.length === 3) [y, m, d] = parts;
  else if (/^\d{8}$/.test(t)) [y, m, d] = [t.slice(0, 4), t.slice(4, 6), t.slice(6)];
  else return null;
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  const ymd = `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
  const dt = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10).replace(/-/g, '') !== ymd) return null;
  // 아직 오지 않은 날짜는 생일일 수 없다 (자정 언저리 시차를 감안해 하루 여유)
  if (+y < 1900 || dt.getTime() > Date.now() + 86400_000) return null;
  return ymd;
}

export function normYear(s) {
  const t = (s || '').trim();
  return /^\d{4}$/.test(t) && +t >= 1900 && +t <= new Date().getFullYear() ? t : null;
}

// '3/14', '0314', '3월 14일' → '0314'
export function normMonthDay(s) {
  const nums = (s || '').match(/\d+/g);
  if (!nums) return null;
  let m, d;
  if (nums.length >= 2) [m, d] = nums;
  else if (/^\d{4}$/.test(nums[0])) [m, d] = [nums[0].slice(0, 2), nums[0].slice(2)];
  else return null;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return m.padStart(2, '0') + d.padStart(2, '0');
}

// '+82 10-1234-5678', '010 1234 5678' → '01012345678'
export function normPhone(s) {
  let d = (s || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2);
  return /^01\d{8,9}$/.test(d) ? d : null;
}

// 학교: 종류(초·중·고·대)는 따로 고르니, 이름 끝의 '초등학교·초', '고등학교·고교·고' 같은 말은 떼고 비교한다.
// '망원초'와 '망원초등학교', '서울여고'와 '서울여자고등학교', '한국외대'와 '한국외국어대학교'가 같은 문이 된다
export const SCHOOL = { e: '초등학교', m: '중학교', h: '고등학교', u: '대학교' };
const SCHOOL_TAIL = {
  e: /(초등학교|국민학교|초교|초)$/,
  m: /(중학교|중)$/,
  h: /(고등학교|고교|고)$/,
  u: /(대학교|대학|대)$/,
};
// 줄여 부르는 말 (여자고등학교 → 여고, 외국어고등학교 → 외고, 교육대학교 → 교대)
const SCHOOL_SHORT = { 여자: '여', 남자: '남', 외국어: '외', 예술: '예', 체육: '체', 공업: '공', 상업: '상', 교육: '교' };
export function normSchool(kind, s) {
  if (!SCHOOL[kind]) return null;
  const t = (s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s​-‍⁠﻿.,·\-_()]/g, '')
    .replace(SCHOOL_TAIL[kind], '')
    .replace(/(여자|남자|외국어|예술|체육|공업|상업|교육)$/, (w) => SCHOOL_SHORT[w]);
  return t.length >= 1 && t.length <= 30 ? t : null;
}
// 이름 끝에 '고등학교'처럼 종류가 분명히 적혀 있으면 그 종류 (줄임말 '고'·'대'는 이름의 일부일 수 있어 보지 않는다)
export function schoolKindOf(s) {
  const t = (s || '').replace(/\s/g, '');
  if (/(초등학교|국민학교|초교)$/.test(t)) return 'e';
  if (/중학교$/.test(t)) return 'm';
  if (/(고등학교|고교)$/.test(t)) return 'h';
  if (/대학교$/.test(t)) return 'u';
  return null;
}

// 답 비교: 띄어쓰기(보이지 않는 공백 포함)·대소문자·문장부호는 무시
export function normAnswer(s) {
  return (s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s​-‍⁠﻿.,!?~'"`·\-_()]/g, '');
}

// ---------- 출입문 ----------
// 쪽지 하나에 출입문을 여러 개 단다. 받는 사람이 자기 정보로 두드리면 맞는 문이 열린다.

export const LEVEL = {
  full: '생일까지 일치',
  phone: '전화번호 일치',
  school: '학교 일치',
  year: '출생연도 일치',
  md: '생일(월·일) 일치',
  pair: '이름 일치',
  sent: '내가 보낸 쪽지',
};

export const identity = {
  full: (name, ymd) => `full|${normName(name)}|${ymd}`,
  year: (name, y) => `year|${normName(name)}|${y}`,
  md: (name, md) => `md|${normName(name)}|${md}`,
  phone: (name, p) => `phone|${normName(name)}|${p}`,
  // 생일을 몰라도 같은 학교를 다닌 사이라면 (school: normSchool을 거친 { kind, name })
  school: (name, s) => `school|${normName(name)}|${s.kind}|${s.name}`,
  pair: (to, from) => `pair|${normName(to)}|${normName(from)}`,
  // 보낸 사람이 폰을 바꿔도 자기 쪽지를 찾을 수 있게 (보낸 사람이 생일을 적었을 때만)
  sent: (from, ymd) => `sent|${normName(from)}|${ymd}`,
};

export async function door(identityString) {
  const base = await pbkdf2(identityString, DOOR_SALT, ITER_DOOR);
  return { id: hex(await hkdf(base, 'door-id')), key: await hkdf(base, 'door-teaser') };
}

// 쓰는 사람: 받는 사람에 대해 아는 만큼으로 출입문 목록을 만든다
export function writerIdentities(to, fromName) {
  const ids = [];
  // 정확한 생일을 알아도 출생연도 문도 함께 단다. 음력·양력을 섞어 쓰는 경우가 많아서.
  if (to.ymd) ids.push(['full', identity.full(to.name, to.ymd)]);
  const year = to.ymd ? to.ymd.slice(0, 4) : to.year;
  if (year) {
    // 빠른년생·나이 착각을 감안해 앞뒤 1년까지
    for (const dy of [-1, 0, 1]) ids.push(['year', identity.year(to.name, String(+year + dy))]);
  }
  if (!to.ymd && to.md) ids.push(['md', identity.md(to.name, to.md)]);
  if (to.phone) ids.push(['phone', identity.phone(to.name, to.phone)]);
  if (to.school) ids.push(['school', identity.school(to.name, to.school)]);
  if (fromName) ids.push(['pair', identity.pair(to.name, fromName)]);
  return ids;
}

// 찾는 사람: 자기 정보는 정확히 아니까, 가능한 모든 형태로 두드린다
export function searcherIdentities(me) {
  const ids = [
    ['full', identity.full(me.name, me.ymd)],
    ['year', identity.year(me.name, me.ymd.slice(0, 4))],
    ['md', identity.md(me.name, me.ymd.slice(4))],
  ];
  if (me.phone) ids.push(['phone', identity.phone(me.name, me.phone)]);
  for (const s of me.schools || []) ids.push(['school', identity.school(me.name, s)]);
  if (me.fromName) ids.push(['pair', identity.pair(me.name, me.fromName)]);
  ids.push(['sent', identity.sent(me.name, me.ymd)]);
  return ids;
}

// ---------- 방 열쇠와 퀴즈 ----------

// 답이 여러 개(가족방·복구 질문 3개)면 모두 맞아야 같은 키가 나온다
export async function quizKeys(answer, saltB64) {
  const secret = Array.isArray(answer) ? answer.map(normAnswer).join('\u241f') : normAnswer(answer);
  const kq = await pbkdf2(secret, b64u.dec(saltB64), ITER_QUIZ);
  return { proof: hex(await hkdf(kq, 'verify')), wrap: await hkdf(kq, 'wrap') };
}

export async function boxKeys(R) {
  return {
    content: await hkdf(R, 'content'),
    access: b64u.enc(await hkdf(R, 'access')),
  };
}

// 방 하나를 새로 만들 때 필요한 값들
export async function newBox(answer) {
  const R = rand(32);
  const salt = b64u.enc(rand(16));
  const { proof, wrap } = await quizKeys(answer, salt);
  const { content, access } = await boxKeys(R);
  return {
    R,
    content,
    access,
    salt,
    verifier: proof,
    wrapped: await seal(wrap, { r: b64u.enc(R) }),
    accessHash: await sha256hex(access),
  };
}

export async function unwrapBox(wrap, wrapped) {
  const obj = await open(wrap, wrapped);
  return obj ? b64u.dec(obj.r) : null;
}

export function newToken() {
  return b64u.enc(rand(32));
}

// 초대 코드: 헷갈리는 글자(0/O, 1/I/L) 제외, 8자
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode(len) {
  return [...rand(len)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export const newInviteCode = () => newCode(8);
export const cleanCode = (s) => (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const fmtCode = (c) => c.match(/.{1,4}/g).join('-');

// 작업 증명: 앞 16비트가 0인 해시를 찾는다. 사람에겐 1~2초, 대량 대입에는 큰 비용.
export async function proofOfWork(boxId, proof) {
  const batch = 512;
  for (let start = 0; ; start += batch) {
    const tries = [];
    for (let n = start; n < start + batch; n++) {
      tries.push(sha256hex(`${boxId}:${proof}:${n}`).then((h) => (h.startsWith(POW_PREFIX) ? n : -1)));
    }
    const hit = (await Promise.all(tries)).find((n) => n >= 0);
    if (hit !== undefined) return String(hit);
  }
}

// 흔해서 쉽게 추측되는 답
const COMMON = new Set(
  [
    '초코', '코코', '보리', '콩이', '뭉치', '몽이', '해피', '두부', '구름', '까미', '사랑', '우유', '별이', '하늘',
    '바둑이', '토리', '감자', '쿠키', '루루', '나비', '호두', '밤이', '다롱이', '똘이', '복실이', '흰둥이', '누렁이',
    '짱구', '뽀삐', '사랑해', '엄마', '아빠', '우리집', '비밀', '몰라', '1234', '0000', '1111', '12345', 'love',
  ].map(normAnswer)
);

export function answerWarning(answer) {
  const a = normAnswer(answer);
  if (a.length < 2) return '답이 너무 짧아요. 두 글자 이상으로 정해 주세요.';
  if (COMMON.has(a) || /^\d{1,4}$/.test(a)) return '이 답은 흔해서 쉽게 추측될 수 있어요. 더 둘만 아는 답을 권해요.';
  return null;
}
