// findme API — 서버는 암호문과 해시만 보관한다. 이름·생일·질문·내용은 모두 브라우저에서 암호화된다.
// 답 확인 값과 잠긴 열쇠는 서버 비밀 열쇠(env.PEPPER)로 한 번 더 잠가 둔다 → src/pepper.js

import { P1, sealVerifier, verifierMatches, sealWrapped, openWrapped } from './pepper.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LIMITS = {
  // 대피소 와이파이처럼 여럿이 IP를 같이 쓰면 남의 틀린 답까지 한 IP로 쌓인다.
  // 그래서 IP+방 조합으로 하루 5번까지는 그냥, 그 뒤로는 사람 확인을 거쳐 30번까지. 넘으면 다음 날까지 막는다.
  unlockPerIpPerBox: 5,
  unlockHumanPerIpPerBox: 30,
  boxFreeFails: 10,       // 방 전체 실패가 하루 이만큼 쌓이면, 그 뒤 시도는 사람 확인(Turnstile)을 거친다
  // 대피소·이동통신망은 수백 명이 IP 하나를 같이 쓴다. IP 제한은 넉넉히, 그 뒤로는 사람 확인으로 거른다.
  findPerIpPerHour: 40,       // 넘으면 사람 확인(Turnstile)을 거쳐야 계속 찾을 수 있다
  findHumanPerIpPerHour: 600, // 사람 확인을 거쳐도 넘을 수 없는 한도
  findPerDoor: 8,             // 찾기 결과에 문 하나에서 담는 쪽지 수(최근 것부터)
  findResults: 48,            // 찾기 결과 전체 한도 (찾는 사람이 보내는 문 6개 × 8)
  createPerIpPerDay: 50,      // 쪽지·가족방 합쳐 하루 50개 (스팸 방지, 대피소처럼 IP를 같이 쓰는 곳 감안). 한국 시간 자정에 다시 채워진다
  postPerIpPerDay: 1000,
  newPostsPerBoxPerDay: 100,  // 기억되지 않은 기기의 글은 방마다 하루 100개까지 (도배 방지)
  powPrefix: '0000',      // 작업 증명: SHA-256 앞 16비트가 0
  maxDoors: 60,           // 가족방: 구성원마다 문 최대 6개
  maxDoorsNote: 8,        // 쪽지: 화면이 만드는 문은 최대 7개(생일·연도 3·전화·이름쌍·보낸 사람). 직접 만든 요청으로 한 쪽지를 수십 명에게 꽂지 못하게
  maxEntriesOnCreate: 4,
  maxCt: 12_000,
  // 요청 본문 한도. 큰 본문으로 워커 CPU 시간을 태우지 못하게 읽기 전에 돌려보낸다.
  // 쪽지·가족방 만들기와 문 추가만 크다(가족방: 문 60개 × 2,000자 + 글 4개 × 12,000자 ≈ 170KB)
  maxBody: 65_536,
  maxBodyCreate: 262_144,
  maxInvitesPerBox: 5,
  visitKeep: 10,          // 접속 기록은 구성원별 최근 10회만
  visitGap: 30 * MIN,     // 30분 안에 다시 들어오면 같은 접속으로 본다
  geocodePerIpPerHour: 200,
  readPerIpPerHour: 300,      // 쪽지·가족방 열기(/read)와 새 소식 확인(/peek). 화면은 429를 받으면 저장본을 보여 준다
  peekMax: 20,                // 새 소식 확인 한 번에 묻는 쪽지·가족방 수
  postsPerBoxPerDay: 300,     // 기억된 기기의 글도 방마다 하루 300개까지 (훔친 기기로 도배하지 못하게)
  v48Factor: 8,               // IPv6는 /64 한도에 더해 /48 대역(서버 업체가 손님 하나에게 주는 크기)에 8배 한도를 한 번 더 센다
  // 전역 서킷 브레이커. 시간당 요청 수를 busySample번에 1번 표본으로 추정한다(D1 쓰기 절약).
  // 추정이 busySoft를 넘으면 find·geocode·stats를 뺀 모든 경로에 사람 확인이 필요하고, busyHard를 넘으면 find도.
  // 무료 플랜 하루 10만 요청 한도를 공격 트래픽이 다 쓰지 못하게. TURNSTILE_SECRET을 지우면 꺼진다(isHuman).
  busySample: 50,
  busySoft: 3000,             // 시간당. 하루 7만 상당
  busyHard: 5000,
  busyRetry: 30,              // 503 busy에 담는 retryAfter(초)
  // 접속 통계(/hello). 하루 접속이 helloWeightAt을 넘으면 신호 10개 중 1개만 기록하고 10으로 센다 (D1 쓰기 한도 보호)
  helloWeightAt: 3000,
  helloWeight: 10,
  adminTriesPerIpPerDay: 10,  // 어드민 열쇠 틀리기는 IP마다 하루 10번까지
  statsDays: 30,              // 어드민 통계가 보여 주는 날짜 범위
};

// 정식 주소. 이 밖(workers.dev 등)에서는 API를 열지 않는다. 도메인에 건 Cloudflare 방어(속도 제한·봇 차단)는
// 다른 주소에 적용되지 않으므로, 누가 workers.dev를 다시 켜도 API는 우회할 수 없게.
const HOSTS = new Set(['findmeinkorea.com', 'localhost', '127.0.0.1']);
const HSTS = 'max-age=31536000; includeSubDomains'; // 정적 파일은 public/_headers가 같은 값을 붙인다
const TOP = new Set(['/api/find', '/api/box', '/api/unlock', '/api/geocode', '/api/peek', '/api/hello', '/api/admin']);

// 해외 접속 정책. 차단 국가(해커가 많은 곳)는 API를 아예 거절하고, 그 밖의 해외(VPN 포함)는 모든 요청에 사람 확인을
// 요구한다(서킷 브레이커와 같은 길: 자기 확인을 하는 경로는 거기에 합치고, 나머지는 'busy' 토큰). 국내(KR)는 영향 없음.
// 1차 방어는 Cloudflare WAF의 국가 차단 규칙(워커까지 오지 않아 무료 한도를 안 쓴다)이고, 여기는 규칙이 꺼져도 남는 2차 방어.
// 정식 주소에서만 적용한다(로컬 개발은 국내로 본다). 비상시 GEO_OFF 변수(wrangler secret put GEO_OFF)로 끈다.
const BLOCKED_COUNTRIES = new Set(['CN', 'RU', 'KP', 'IR', 'T1']); // T1 = Tor 출구
function region(request, env, hostname) {
  if (env.GEO_OFF || hostname !== 'findmeinkorea.com') return 'home';
  const c = request.cf?.country;
  if (!c || c === 'KR') return 'home';
  return BLOCKED_COUNTRIES.has(c) ? 'blocked' : 'abroad';
}
// 사람 확인(Turnstile)을 스스로 하는 경로. 토큰은 한 번만 검증할 수 있어 서킷 브레이커가 따로 검증하지 않고 busy만 넘긴다
const SELF_HUMAN = new Set(['/api/find', '/api/box', '/api/unlock', 'recover']);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'strict-transport-security': HSTS },
  });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

const enc = new TextEncoder();
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomId(bytes = 12) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const kstDay = (ts = Date.now()) => new Date(ts + 9 * HOUR).toISOString().slice(0, 10);
const kstMidnight = (ts = Date.now()) => Date.parse(kstDay(ts) + 'T00:00:00+09:00');

// IP 원본은 저장하지 않는다. 날짜가 섞인 해시라 다음 날이면 연결할 수 없다.
// IPv6는 기기 하나가 /64 대역 안에서 주소를 마음대로 바꿀 수 있어서 앞 64비트(4묶음)로 센다(k64).
// 서버 업체는 손님 하나에게 /48(= /64 65,536개)을 주므로 앞 48비트(3묶음) 키(k48)로 한 번 더 센다. IPv4는 k48이 없다.
async function ipKey(request) {
  let ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  // ::ffff:1.2.3.4 꼴은 IPv4다. /64로 묶으면 이런 꼴로 오는 모든 IPv4가 한 사람으로 셈된다
  if (ip.includes('.')) ip = ip.slice(ip.lastIndexOf(':') + 1);
  const v6 = ip.includes(':');
  const day = kstDay();
  return {
    k64: (await sha256hex(`ip:${v6 ? v6Prefix(ip, 4) : ip}:${day}`)).slice(0, 24),
    k48: v6 ? (await sha256hex(`ip:${v6Prefix(ip, 3)}:${day}`)).slice(0, 24) : null,
  };
}

function v6Prefix(ip, groups) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, groups).map((g) => parseInt(g || '0', 16).toString(16)).join(':') + `::/${groups * 16}`;
}

async function counterGet(db, k) {
  const row = await db.prepare('SELECT n, exp FROM counters WHERE k = ?').bind(k).first();
  return row && row.exp > Date.now() ? row.n : 0;
}
async function counterHit(db, k, ttl) {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO counters (k, n, exp) VALUES (?1, 1, ?2)
       ON CONFLICT(k) DO UPDATE SET
         n   = CASE WHEN counters.exp > ?3 THEN counters.n + 1 ELSE 1 END,
         exp = CASE WHEN counters.exp > ?3 THEN counters.exp ELSE ?2 END
       RETURNING n`
    )
    .bind(k, now + ttl, now)
    .first();
  return row.n;
}
// 이미 넘은 요청은 기록하지 않는다. 몰려드는 요청이 무료 DB 쓰기 한도를 갉아먹지 않게.
async function overLimit(db, k, ttl, max) {
  if ((await counterGet(db, k)) >= max) return true;
  return (await counterHit(db, k, ttl)) > max;
}
// IP 한도: /64 키(k64)로 세고, IPv6면 /48 키(k48)에 8배 한도를 한 번 더 센다. IPv4는 두 번째 검사를 건너뛴다(D1 쓰기 절약).
async function overIpLimit(db, ip, keyOf, ttl, max) {
  if (await overLimit(db, keyOf(ip.k64), ttl, max)) return true;
  return !!ip.k48 && (await overLimit(db, keyOf(ip.k48), ttl, max * LIMITS.v48Factor));
}

// 전역 서킷 브레이커. 요청이 무료 한도에 가까워지면 사람 확인을 거친 요청만 받는다.
// 0: 평소 · 1: find·geocode·stats를 뺀 모든 경로에 사람 확인 · 2: find도 사람 확인
async function loadLevel(db) {
  const k = `all:${Math.floor(Date.now() / HOUR)}`;
  const n = Math.random() < 1 / LIMITS.busySample ? await counterHit(db, k, HOUR) : await counterGet(db, k);
  const est = n * LIMITS.busySample;
  return est > LIMITS.busyHard ? 2 : est > LIMITS.busySoft ? 1 : 0;
}

const isStr = (v, max = LIMITS.maxCt) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isHex = (v, len = 64) => typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v);

// 쪽지·가족방을 만들 때 사람인지 확인 (Cloudflare Turnstile).
// TURNSTILE_SECRET을 지우면 확인 없이 동작한다. 전쟁 중 Turnstile이 막히면 이것으로 끈다.
async function isHuman(env, token, action) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!isStr(token, 4096)) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    const r = await res.json();
    return r.success === true && (!r.action || r.action === action);
  } catch {
    return false;
  }
}

// 본문 한도: 쪽지·가족방 만들기와 문 추가만 크다
const bodyLimit = (path) => (path === '/api/box' || path.endsWith('/doors') ? LIMITS.maxBodyCreate : LIMITS.maxBody);

// 길이를 알린 요청은 fetch()가 읽기 전에 한도를 확인했다. 길이를 알리지 않고 보내는 요청(chunked)은
// 읽으면서 세다가 한도를 넘으면 더 읽지 않는다.
// 같은 요청의 본문은 한 번만 읽는다(fetch()의 서킷 브레이커가 먼저 읽을 수 있다).
const bodies = new WeakMap();
async function readBody(request, max = LIMITS.maxBody) {
  if (!bodies.has(request)) bodies.set(request, await readBodyOnce(request, max));
  return bodies.get(request);
}
async function readBodyOnce(request, max) {
  try {
    if (request.headers.has('content-length')) return await request.json();
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return null;
  }
}

async function loadBox(db, id) {
  if (!isStr(id, 40)) return null;
  return db.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first();
}

async function checkAccess(db, id, access) {
  const box = await loadBox(db, id);
  if (!box || !isStr(access, 100)) return null;
  return safeEqual(await sha256hex(access), box.access_hash) ? box : null;
}

// 기기 토큰만 (초대·복구 코드는 기기 토큰으로 쓸 수 없다)
async function tokenInfo(db, boxId, token) {
  if (!isStr(token, 100)) return null;
  return db
    .prepare("SELECT role, slot FROM tokens WHERE box_id = ? AND token_hash = ? AND role IN ('owner', 'admin', 'device')")
    .bind(boxId, await sha256hex(token))
    .first();
}

async function touchSeen(db, boxId, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) return;
  const now = Date.now();
  const prev = await db.prepare('SELECT last_seen FROM seen WHERE box_id = ? AND slot = ?').bind(boxId, slot).first();
  const stmts = [
    db
      .prepare(
        `INSERT INTO seen (box_id, slot, last_seen) VALUES (?, ?, ?)
         ON CONFLICT(box_id, slot) DO UPDATE SET last_seen = excluded.last_seen`
      )
      .bind(boxId, slot, now),
  ];
  if (!prev || now - prev.last_seen > LIMITS.visitGap) {
    stmts.push(
      db.prepare('INSERT INTO visits (box_id, slot, at) VALUES (?, ?, ?)').bind(boxId, slot, now),
      db
        .prepare(
          `DELETE FROM visits WHERE box_id = ?1 AND slot = ?2 AND at NOT IN
             (SELECT at FROM visits WHERE box_id = ?1 AND slot = ?2 ORDER BY at DESC LIMIT ?3)`
        )
        .bind(boxId, slot, LIMITS.visitKeep)
    );
  }
  await db.batch(stmts);
}

// ---------- 핸들러 ----------

// 첫 화면마다 표 전체를 세면 사용자가 늘수록 DB 읽기가 폭증한다. 5분간 엣지에 캐시해 둔다.
async function stats(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL('/api/stats', request.url));
  const hit = await cache.match(key);
  if (hit) {
    // 캐시를 거치면 Cache-Control이 영역 기본값(4시간)으로 바뀌므로 다시 5분으로 맞춘다.
    const res = new Response(hit.body, hit);
    res.headers.set('cache-control', 'public, max-age=300');
    return res;
  }
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM boxes WHERE created_at >= ?')
    .bind(kstMidnight())
    .first();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM boxes').first();
  const res = new Response(JSON.stringify({ today: today.n, total: total.n }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'strict-transport-security': HSTS },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function find(request, env, busy) {
  const body = await readBody(request);
  const doors = body?.doors;
  if (!Array.isArray(doors) || doors.length === 0 || doors.length > 8 || !doors.every((d) => isHex(d))) {
    return fail(400, 'bad_request');
  }
  const ip = await ipKey(request);
  const hour = Math.floor(Date.now() / HOUR);
  // 같은 IP를 쓰는 사람이 많을 수 있으니 한도를 넘어도(또는 요청이 몰려도: busy) 막지 않고 사람인지 확인한다
  if (busy || (await overIpLimit(env.DB, ip, (k) => `f:${k}:${hour}`, HOUR, LIMITS.findPerIpPerHour))) {
    if (!(await isHuman(env, body.human, 'find'))) return fail(403, 'human');
    if (await overIpLimit(env.DB, ip, (k) => `fh:${k}:${hour}`, HOUR, LIMITS.findHumanPerIpPerHour)) return fail(429, 'too_many');
  }
  const marks = doors.map(() => '?').join(',');
  // 문 하나에서는 최근 쪽지 몇 개만 담는다. 유명인처럼 이름·생일이 알려진 사람의 문에 팬 쪽지가 수백 개
  // 몰려도, 전화번호·보낸 사람 이름까지 맞는 문의 쪽지가 한도 밖으로 밀려나지 않게.
  // 그래도 한도를 넘으면 앞에 보낸 문(찾는 사람이 더 정확하다고 본 문)부터 남긴다.
  const rank = doors.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
  const { results } = await env.DB.prepare(
    `SELECT door, teaser, box, type, salt, created_at, hidden, last_at FROM (
       SELECT d.door_id AS door, d.teaser, b.id AS box, b.type, b.salt, b.created_at, b.hidden,
              -- 마지막 기록: 기억된 기기(✅)의 글만. 답을 아는 남이 글을 올려 최근 쪽지처럼 꾸미지 못하게
              (SELECT MAX(e.created_at) FROM entries e
                WHERE e.box_id = b.id AND e.badge IN ('owner', 'admin', 'device')) AS last_at,
              ROW_NUMBER() OVER (PARTITION BY d.door_id ORDER BY d.created_at DESC) AS n,
              CASE d.door_id ${rank} END AS r
         FROM doors d JOIN boxes b ON b.id = d.box_id
        WHERE d.door_id IN (${marks}) AND (b.hidden = 0 OR d.always = 1))
      WHERE n <= ${LIMITS.findPerDoor}
      ORDER BY r, n
      LIMIT ${LIMITS.findResults}`
  )
    .bind(...doors, ...doors)
    .all();
  return json({ results });
}

const isSlot = (v) => Number.isInteger(v) && v >= 0 && v <= 99;

async function createBox(request, env) {
  const b = await readBody(request, LIMITS.maxBodyCreate);
  if (!b) return fail(400, 'bad_request');
  const { type, salt, verifier, wrapped, accessHash, doors, tokens, entries, mutual } = b;
  const creatorRole = type === 'note' ? 'owner' : type === 'room' ? 'admin' : null;
  const valid =
    creatorRole &&
    isStr(salt, 64) &&
    isHex(verifier) &&
    isStr(wrapped, 400) &&
    isHex(accessHash) &&
    Array.isArray(doors) && doors.length > 0 && doors.length <= (type === 'note' ? LIMITS.maxDoorsNote : LIMITS.maxDoors) &&
    doors.every((d) => isHex(d?.door) && isStr(d?.teaser, 2000)) &&
    // 만든 사람의 기기 토큰
    Array.isArray(tokens) && tokens.length === 1 &&
    isHex(tokens[0]?.hash) && tokens[0]?.role === creatorRole && isSlot(tokens[0]?.slot) &&
    Array.isArray(entries) && entries.length > 0 && entries.length <= LIMITS.maxEntriesOnCreate &&
    entries.every((e) => isStr(e?.ct)) &&
    // 맞쪽지: want = 상대가 나에게 쓴 쪽지라면 갖게 될 이름끼리 출입문 ID, wantYear = 그 쪽지가 함께 가질
    // "내 이름 + 내 출생연도" 출입문 ID, always = 숨어 있어도 보일 내 출입문 위치.
    // wantYear가 없는 건 예전 화면(기기에 저장된 옛 버전)에서 온 요청이라 받아 준다.
    (mutual === undefined ||
      (type === 'note' && isHex(mutual?.want) && (mutual.wantYear === undefined || isHex(mutual.wantYear)) &&
        Array.isArray(mutual.always) && mutual.always.length <= 2 &&
        mutual.always.every((i) => Number.isInteger(i) && i >= 0 && i < doors.length)));
  if (!valid) return fail(400, 'bad_request');
  // 오늘 몫을 다 쓴 IP는 사람 확인 전에 돌려보낸다. 셈은 확인을 통과한 뒤에만 올린다
  const ip = await ipKey(request);
  // 이미 넘은 IP는 사람 확인 전에 돌려보낸다(Turnstile 호출 절약)
  if ((await counterGet(env.DB, `c:${ip.k64}`)) >= LIMITS.createPerIpPerDay) return fail(429, 'create_limit');
  if (!(await isHuman(env, b.human, 'create'))) return fail(403, 'human');
  if (await overIpLimit(env.DB, ip, (k) => `c:${k}`, DAY, LIMITS.createPerIpPerDay)) return fail(429, 'create_limit');

  const id = randomId();
  const now = Date.now();
  const slot = tokens[0].slot;
  // 맞쪽지는 숨긴 채 넣고, 상대가 이미 나에게 쪽지를 썼는지는 같은 묶음 안에서 확인해 푼다(맨 아래).
  // 미리 따로 확인하면 두 사람이 동시에 맞쪽지를 쓸 때 서로 상대 쪽지를 못 봐서 한쪽이 영영 숨는다.
  const hidden = mutual ? 1 : 0;
  const always = new Set(mutual?.always || []);
  const stmts = [
    env.DB.prepare(
      'INSERT INTO boxes (id, type, salt, verifier, wrapped, access_hash, created_at, hidden, want, want_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, type, salt, await sealVerifier(env.PEPPER, verifier), await sealWrapped(env.PEPPER, wrapped), accessHash, now,
      hidden, mutual?.want ?? null, mutual?.wantYear ?? null
    ),
    ...tokens.map((t) =>
      env.DB.prepare('INSERT INTO tokens (box_id, token_hash, role, slot, created_at) VALUES (?, ?, ?, ?, ?)').bind(
        id, t.hash, t.role, slot, now
      )
    ),
    env.DB.prepare('INSERT INTO seen (box_id, slot, last_seen) VALUES (?, ?, ?)').bind(id, slot, now),
    env.DB.prepare('INSERT INTO visits (box_id, slot, at) VALUES (?, ?, ?)').bind(id, slot, now),
    ...doors.map((d, i) =>
      env.DB.prepare('INSERT INTO doors (door_id, box_id, teaser, created_at, always) VALUES (?, ?, ?, ?, ?)').bind(
        d.door, id, d.teaser, now, always.has(i) ? 1 : 0
      )
    ),
    // 이 쪽지를 기다리던 맞쪽지들이 있으면 숨김을 푼다: 이름끼리 문과 (있으면) 출생연도 문이 둘 다 이 쪽지에 있어야.
    // 어느 쪽지가 풀렸는지는 응답에 담지 않는다(남을 흉내 내 "누가 누구에게 맞쪽지를 썼는지" 떠볼 수 있으니까).
    env.DB.prepare(
      `UPDATE boxes SET hidden = 0 WHERE hidden = 1 AND id != ?
         AND want IN (${doors.map(() => '?').join(',')})
         AND (want_year IS NULL OR want_year IN (${doors.map(() => '?').join(',')}))`
    ).bind(id, ...doors.map((d) => d.door), ...doors.map((d) => d.door)),
    ...entries.map((e) =>
      env.DB.prepare('INSERT INTO entries (box_id, ct, badge, slot, created_at) VALUES (?, ?, ?, ?, ?)').bind(
        id, e.ct, creatorRole, slot, now
      )
    ),
    ...(mutual
      ? [
          env.DB.prepare(
            `UPDATE boxes SET hidden = 0 WHERE id = ? AND hidden = 1
               AND EXISTS (SELECT 1 FROM doors p WHERE p.door_id = boxes.want AND p.box_id != boxes.id
                 AND (boxes.want_year IS NULL OR EXISTS
                   (SELECT 1 FROM doors y WHERE y.box_id = p.box_id AND y.door_id = boxes.want_year)))`
          ).bind(id),
        ]
      : []),
  ];
  await env.DB.batch(stmts);
  return json({ id });
}

async function unlock(request, env, busy) {
  const b = await readBody(request);
  if (!b || !isHex(b.proof) || !isStr(b.nonce, 20)) return fail(400, 'bad_request');
  const box = await loadBox(env.DB, b.box);
  if (!box) return fail(404, 'not_found');
  // 받는 사람이 지운 쪽지는 예전 찾기 결과를 들고 있던 기기에서도 다시 열 수 없다
  if (box.closed_at) return fail(410, 'closed');
  // 숨어 있는 맞쪽지는 아무도 열 수 없다. 보낸 사람의 이름·생일과 답을 아는 남이
  // "내가 보낸 쪽지" 문으로 들어와, 상대가 쓰기도 전에 읽는 일을 막는다.
  if (box.hidden) return fail(403, 'hidden');

  const now = Date.now();
  const ip = await ipKey(request);
  const key = `u:${ip.k64}:${box.id}`;
  const key48 = ip.k48 && `u:${ip.k48}:${box.id}`; // IPv6 /48 대역 전체로는 8배까지
  const used = await counterGet(env.DB, key);
  if (used >= LIMITS.unlockHumanPerIpPerBox) return fail(429, 'limit', { remaining: 0 });
  if (key48 && (await counterGet(env.DB, key48)) >= LIMITS.unlockHumanPerIpPerBox * LIMITS.v48Factor) {
    return fail(429, 'limit', { remaining: 0 });
  }

  // 한 IP에서 틀린 답이 쌓이거나 여러 IP에서 틀린 답이 몰리면(또는 요청이 몰리면: busy) 잠그지 않고 사람 확인을 요구한다.
  // 잠그면 공격자(또는 같은 와이파이의 다른 가족)가 진짜 받는 사람까지 막을 수 있기 때문이다.
  const fails = now - box.last_fail_at > DAY ? 0 : box.fail_count;
  if ((busy || used >= LIMITS.unlockPerIpPerBox || fails >= LIMITS.boxFreeFails) && !(await isHuman(env, b.human, 'unlock'))) {
    return fail(403, 'human');
  }

  // 작업 증명: 시도마다 브라우저가 계산해야 하는 값. 정답 후보(proof)가 섞여 있어 재사용할 수 없다.
  const pow = await sha256hex(`${box.id}:${b.proof}:${b.nonce}`);
  if (!pow.startsWith(LIMITS.powPrefix)) return fail(400, 'bad_pow');

  if (await verifierMatches(env.PEPPER, b.proof, box.verifier, safeEqual)) {
    if (box.fail_count) {
      await env.DB.prepare('UPDATE boxes SET fail_count = 0 WHERE id = ?').bind(box.id).run();
    }
    // 아직 예전 값으로 남은 쪽지는 열리는 김에 잠가 둔다
    if (!box.verifier.startsWith(P1) || !box.wrapped.startsWith(P1)) {
      await env.DB.prepare('UPDATE boxes SET verifier = ?, wrapped = ? WHERE id = ?')
        .bind(
          box.verifier.startsWith(P1) ? box.verifier : await sealVerifier(env.PEPPER, box.verifier),
          box.wrapped.startsWith(P1) ? box.wrapped : await sealWrapped(env.PEPPER, box.wrapped),
          box.id
        )
        .run();
    }
    return json({ wrapped: await openWrapped(env.PEPPER, box.wrapped) });
  }

  const n = await counterHit(env.DB, key, DAY);
  if (key48) await counterHit(env.DB, key48, DAY);
  await env.DB.prepare('UPDATE boxes SET fail_count = ?, last_fail_at = ? WHERE id = ?')
    .bind(fails + 1, now, box.id)
    .run();
  return fail(403, 'wrong', { remaining: Math.max(0, LIMITS.unlockHumanPerIpPerBox - n) });
}

async function readBox(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  const ip = await ipKey(request);
  if (await overIpLimit(env.DB, ip, (k) => `rd:${k}:${Math.floor(Date.now() / HOUR)}`, HOUR, LIMITS.readPerIpPerHour)) {
    return fail(429, 'too_many');
  }
  const since = Number.isInteger(b.since) ? b.since : 0;
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok) await touchSeen(env.DB, id, tok.slot);
  // 머리말(첫 글) + 기억된 기기의 최근 글 200개 + 전체 최근 글 300개.
  // 답을 아는 남이 글을 도배해도 머리말과 보낸 사람·그룹장의 장소 글은 밀려나지 않는다.
  const { results: entries } = await env.DB.prepare(
    `SELECT id, ct, badge, slot, created_at AS at FROM entries
      WHERE box_id = ?1 AND id > ?2 AND (
        id = (SELECT MIN(id) FROM entries WHERE box_id = ?1)
        OR id IN (SELECT id FROM entries WHERE box_id = ?1 AND badge IN ('owner', 'admin', 'device') ORDER BY id DESC LIMIT 200)
        OR id IN (SELECT id FROM entries WHERE box_id = ?1 ORDER BY id DESC LIMIT 300))
      ORDER BY id`
  )
    .bind(id, since)
    .all();
  const { results: seen } = await env.DB.prepare('SELECT slot, last_seen AS at FROM seen WHERE box_id = ?')
    .bind(id)
    .all();
  const { results: visits } = await env.DB.prepare(
    'SELECT slot, at FROM visits WHERE box_id = ? ORDER BY at DESC LIMIT 1000'
  )
    .bind(id)
    .all();
  const { results: recoveryRows } = await env.DB.prepare('SELECT slot, role, salt, ct FROM recovery WHERE box_id = ?')
    .bind(id)
    .all();
  const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE box_id = ? AND role = 'admin'")
    .bind(id)
    .first();
  return json({
    admins: admins.n,
    type: box.type,
    hidden: !!box.hidden,
    closed: box.closed_at || null,
    recovery: recoveryRows,
    role: tok ? tok.role : null,
    slot: tok?.slot ?? null,
    entries,
    seen,
    visits,
    fails: { n: box.fail_count, at: box.last_fail_at },
  });
}

// ---------- 접속 통계 ----------
// 화면이 기기마다 하루 한 번 보내는 신호(app.js hello). 날짜별 숫자만 더하고 누가 왔는지는 남기지 않는다.
// 국가는 Cloudflare가 알려 준 값(request.cf.country), 유입 경로·첫 화면은 화면이 보낸 값 중 아는 것만.
const REFS = new Set(['direct', 'kakao', 'naver', 'daum', 'google', 'instagram', 'facebook', 'x', 'telegram', 'youtube', 'other']);
const ROUTES = new Set(['home', 'find', 'results', 'write', 'room', 'box', 'unlock', 'about', 'other']);

// 하루 집계(k)가 at을 넘으면 10개 중 1개만 기록하고 10으로 센다 (추정치). 무료 DB 쓰기 한도(10만/일)를 지키려고.
// 기록하지 않을 차례면 0
async function weight(db, day, k, at) {
  const row = await db.prepare('SELECT n FROM stats WHERE day = ? AND k = ?').bind(day, k).first();
  if ((row?.n || 0) < at) return 1;
  return Math.random() < 1 / LIMITS.helloWeight ? LIMITS.helloWeight : 0;
}
async function bump(db, day, keys, w) {
  if (!w) return;
  await db
    .prepare(
      `INSERT INTO stats (day, k, n) VALUES ${keys.map((_, i) => `(?1, ?${i + 3}, ?2)`).join(', ')}
       ON CONFLICT(day, k) DO UPDATE SET n = stats.n + excluded.n`
    )
    .bind(day, w, ...keys)
    .run();
}

async function hello(request, env) {
  const b = await readBody(request);
  const day = kstDay();
  // 가짜 관리 페이지(#/admin)에 열쇠를 넣어 본 횟수. 누가 노리는지 보려고 센다
  if (b?.decoy === true) {
    await bump(env.DB, day, ['decoy'], await weight(env.DB, day, 'decoy', 1000));
    return json({ ok: true });
  }
  const ref = REFS.has(b?.ref) ? b.ref : 'other';
  const route = ROUTES.has(b?.route) ? b.route : 'other';
  const country = /^[A-Z0-9]{2}$/.test(request.cf?.country || '') ? request.cf.country : 'XX';
  const w = await weight(env.DB, day, 'uv', LIMITS.helloWeightAt);
  const keys = ['uv', `c:${country}`, `r:${ref}`, `e:${route}`];
  if (b?.first === true) keys.push('new');
  await bump(env.DB, day, keys, w);
  return json({ ok: true });
}

// 어드민 통계(#/admin). 관리 열쇠(ADMIN_KEY 비밀 변수)가 맞을 때만, 집계 숫자만 돌려준다. 열쇠가 없으면 기능 자체가 없다.
async function adminStats(request, env) {
  if (!env.ADMIN_KEY) return fail(404, 'not_found');
  const b = await readBody(request);
  const ip = await ipKey(request);
  const tries = `ak:${ip.k64}`;
  if ((await counterGet(env.DB, tries)) >= LIMITS.adminTriesPerIpPerDay) return fail(429, 'limit');
  if (!isStr(b?.key, 200) || !safeEqual(b.key, env.ADMIN_KEY)) {
    await counterHit(env.DB, tries, DAY);
    return fail(403, 'denied');
  }
  const since = kstMidnight() - (LIMITS.statsDays - 1) * DAY;
  const dayOf = "date(created_at / 1000, 'unixepoch', '+9 hours')";
  // 월별 그래프: 이번 달까지 12달
  const now = new Date(Date.now() + 9 * HOUR);
  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const [daily, boxTotals, boxDaily, entryTotal, entryDaily, devices, newTotal, months] = await env.DB.batch([
    env.DB.prepare('SELECT day, k, n FROM stats WHERE day >= ? ORDER BY day').bind(kstDay(since)),
    env.DB.prepare('SELECT type, COUNT(*) AS n FROM boxes GROUP BY type'),
    env.DB.prepare(`SELECT ${dayOf} AS day, type, COUNT(*) AS n FROM boxes WHERE created_at >= ? GROUP BY day, type`).bind(since),
    env.DB.prepare('SELECT COUNT(*) AS n FROM entries'),
    env.DB.prepare(`SELECT ${dayOf} AS day, COUNT(*) AS n FROM entries WHERE created_at >= ? GROUP BY day`).bind(since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE role IN ('owner', 'admin', 'device')"),
    env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM stats WHERE k = 'new'"),
    env.DB.prepare(
      "SELECT substr(day, 1, 7) AS m, k, SUM(n) AS n FROM stats WHERE k IN ('uv', 'new') AND day >= ? GROUP BY m, k ORDER BY m"
    ).bind(monthFrom),
  ]);
  return json({
    today: kstDay(),
    days: LIMITS.statsDays,
    stats: daily.results,
    months: months.results,
    boxes: { total: boxTotals.results, daily: boxDaily.results },
    entries: { total: entryTotal.results[0].n, daily: entryDaily.results },
    devices: devices.results[0].n,
    newTotal: newTotal.results[0].n,
  });
}

// 홈 화면의 "새 소식" 뱃지. 기억된 쪽지·가족방마다 남이 남긴 마지막 글과 마지막 접속 시각만 돌려준다.
// 내용(암호문)은 보내지 않고, 열쇠(access)가 맞는 방만 답한다. 열기(/read)와 같은 시간당 한도를 쓴다.
async function peek(request, env) {
  const b = await readBody(request);
  const list = b?.boxes;
  if (!Array.isArray(list) || list.length === 0 || list.length > LIMITS.peekMax) return fail(400, 'bad_request');
  const ip = await ipKey(request);
  if (await overIpLimit(env.DB, ip, (k) => `rd:${k}:${Math.floor(Date.now() / HOUR)}`, HOUR, LIMITS.readPerIpPerHour)) {
    return fail(429, 'too_many');
  }
  const boxes = [];
  for (const item of list) {
    const box = await checkAccess(env.DB, item?.id, item?.access);
    if (!box) continue;
    const tok = await tokenInfo(env.DB, box.id, item.token);
    // 내 자리의 글·접속은 뺀다. 새 기기가 내 자리 번호를 달고 쓴 글(badge new)은 남의 글로 센다.
    // 기억된 기기가 아니면(-2) 모두 남의 것으로 센다 (자리 없는 글은 -1)
    const mine = Number.isInteger(tok?.slot) ? tok.slot : -2;
    const row = await env.DB.prepare(
      `SELECT
         (SELECT MAX(created_at) FROM entries WHERE box_id = ?1 AND NOT (COALESCE(slot, -1) = ?2 AND badge != 'new')) AS entry,
         (SELECT MAX(at) FROM visits WHERE box_id = ?1 AND slot != ?2) AS visit`
    )
      .bind(box.id, mine)
      .first();
    boxes.push({ id: box.id, entry: row?.entry || 0, visit: row?.visit || 0, closed: !!box.closed_at });
  }
  return json({ boxes });
}

async function postEntry(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  if (box.closed_at) return fail(410, 'closed');
  if (!isStr(b.ct)) return fail(400, 'bad_request');
  const ip = await ipKey(request);
  if (await overIpLimit(env.DB, ip, (k) => `p:${k}`, DAY, LIMITS.postPerIpPerDay)) return fail(429, 'too_many');

  const tok = await tokenInfo(env.DB, id, b.token);
  const verified = !!tok;
  // 기억되지 않은 기기의 글은 방마다 하루 100개, 기억된 기기의 글도 300개까지
  const boxKey = verified ? `pb2:${id}` : `pb:${id}`;
  if (await overLimit(env.DB, boxKey, DAY, verified ? LIMITS.postsPerBoxPerDay : LIMITS.newPostsPerBoxPerDay)) {
    return fail(429, 'box_busy');
  }
  const badge = verified ? tok.role : 'new';
  const slot = verified ? tok.slot : isSlot(b.slot) ? b.slot : null;
  const row = await env.DB.prepare(
    'INSERT INTO entries (box_id, ct, badge, slot, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
  )
    .bind(id, b.ct, badge, slot, Date.now())
    .first();
  // 마지막 접속은 기억된 기기만 갱신한다. 새 기기 글로 남의 생존 신호를 꾸밀 수 없게.
  if (verified) await touchSeen(env.DB, id, slot);
  return json({ id: row.id, badge });
}

async function registerDevice(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  // 자리(0~99)마다 기기 하나라 기기 토큰은 방마다 100개를 넘지 않는다.
  // 방 전체 개수로 막으면, 답을 아는 남이 없는 자리를 채워 진짜 가족이 기억하지 못하게 할 수 있다.
  if (!isHex(b.tokenHash) || !Number.isInteger(b.slot) || b.slot < 0 || b.slot > 99) return fail(400, 'bad_request');
  // 한 사람 자리에는 처음 기억한 기기만. 답을 아는 다른 사람이 그 사람인 척 ✅ 배지와 접속 기록을 얻지 못하게.
  // 폰을 바꾼 보낸 사람·그룹장은 복구 질문으로 되찾고, 남이 먼저 차지한 자리는 보낸 사람·그룹장이 풀어 준다.
  const taken = await env.DB.prepare(
    "SELECT 1 FROM tokens WHERE box_id = ? AND slot = ? AND role IN ('owner', 'admin', 'device') LIMIT 1"
  )
    .bind(id, b.slot)
    .first();
  if (taken) return fail(409, 'taken');
  await env.DB.prepare(
    'INSERT OR IGNORE INTO tokens (box_id, token_hash, role, slot, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, b.tokenHash, 'device', b.slot, Date.now())
    .run();
  await touchSeen(env.DB, id, b.slot);
  return json({ ok: true });
}

// 보낸 사람·그룹장이 다른 사람 자리에 기억된 기기를 풀어 준다.
// 답을 아는 남이 그 자리를 먼저 차지했거나, 구성원이 폰을 바꿨을 때. 그룹장 자리는 풀 수 없다(복구 질문으로).
async function releaseSlot(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok?.role !== 'admin' && tok?.role !== 'owner') return fail(403, 'denied');
  if (!Number.isInteger(b.slot) || b.slot === tok.slot) return fail(400, 'bad_request');
  const r = await env.DB.prepare("DELETE FROM tokens WHERE box_id = ? AND slot = ? AND role = 'device'")
    .bind(id, b.slot)
    .run();
  return json({ released: r.meta.changes });
}

// 그룹장이 "함께 관리할 사람" 초대 코드를 만든다. 코드는 브라우저에서 만들고 해시만 보낸다.
async function createInvite(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box || box.type !== 'room') return fail(403, 'denied');
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok?.role !== 'admin' || !isHex(b.inviteHash)) return fail(403, 'denied');
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE box_id = ? AND role = 'invite'")
    .bind(id)
    .first();
  if (open.n >= LIMITS.maxInvitesPerBox) return fail(429, 'too_many');
  await env.DB.prepare('INSERT INTO tokens (box_id, token_hash, role, slot, created_at) VALUES (?, ?, ?, NULL, ?)')
    .bind(id, b.inviteHash, 'invite', Date.now())
    .run();
  return json({ ok: true });
}

// 초대 코드(8자): 가족방 공동 그룹장이 된다. 이 기기가 누구인지(slot)를 함께 보낸다.
async function claimCode(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  if (box.type !== 'room') return fail(400, 'bad_request');
  if (!isStr(b.code, 20) || !isHex(b.tokenHash)) return fail(400, 'bad_request');
  if (!Number.isInteger(b.slot) || b.slot < 0 || b.slot > 99) return fail(400, 'need_slot');
  const ip = await ipKey(request);
  if (await overIpLimit(env.DB, ip, (k) => `i:${k}:${id}`, DAY, 10)) return fail(429, 'too_many');

  const codeHash = await sha256hex(b.code.toUpperCase());
  const found = await env.DB.prepare("SELECT 1 FROM tokens WHERE box_id = ? AND token_hash = ? AND role = 'invite'")
    .bind(id, codeHash)
    .first();
  if (!found) return fail(403, 'wrong');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tokens WHERE box_id = ? AND token_hash = ?').bind(id, codeHash),
    env.DB.prepare('INSERT OR REPLACE INTO tokens (box_id, token_hash, role, slot, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, b.tokenHash, 'admin', b.slot, Date.now()),
  ]);
  await touchSeen(env.DB, id, b.slot);
  return json({ role: 'admin', slot: b.slot });
}

// 복구 질문 만들기·바꾸기: 보낸 사람·그룹장 기기만. 질문은 방 열쇠로 암호화돼 있다.
async function setRecovery(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok?.role !== 'admin' && tok?.role !== 'owner') return fail(403, 'denied');
  if (!isStr(b.salt, 64) || !isHex(b.verifier) || !isStr(b.ct, 2000)) return fail(400, 'bad_request');
  await env.DB.prepare(
    'INSERT OR REPLACE INTO recovery (box_id, slot, role, salt, verifier, ct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tok.slot, tok.role, b.salt, await sealVerifier(env.PEPPER, b.verifier), b.ct, Date.now())
    .run();
  return json({ ok: true });
}

// 폰을 잃어버린 보낸 사람·그룹장이 세 답을 모두 맞혀 권한을 되찾는다.
// 잃어버린 기기의 권한은 끊긴다. 답 대입은 퀴즈와 같은 방식으로 막는다.
async function recover(id, request, env, busy) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  if (!Number.isInteger(b.slot) || !isHex(b.proof) || !isStr(b.nonce, 20) || !isHex(b.tokenHash)) {
    return fail(400, 'bad_request');
  }
  const row = await env.DB.prepare('SELECT * FROM recovery WHERE box_id = ? AND slot = ?').bind(id, b.slot).first();
  if (!row) return fail(404, 'not_found');

  const ip = await ipKey(request);
  const key = `r:${ip.k64}:${id}`;
  const key48 = ip.k48 && `r:${ip.k48}:${id}`;
  const used = await counterGet(env.DB, key);
  if (used >= LIMITS.unlockHumanPerIpPerBox) return fail(429, 'limit', { remaining: 0 });
  if (key48 && (await counterGet(env.DB, key48)) >= LIMITS.unlockHumanPerIpPerBox * LIMITS.v48Factor) {
    return fail(429, 'limit', { remaining: 0 });
  }
  const boxKey = `rf:${id}`;
  const many = busy || used >= LIMITS.unlockPerIpPerBox || (await counterGet(env.DB, boxKey)) >= LIMITS.boxFreeFails;
  if (many && !(await isHuman(env, b.human, 'recover'))) return fail(403, 'human');
  const pow = await sha256hex(`${id}:${b.proof}:${b.nonce}`);
  if (!pow.startsWith(LIMITS.powPrefix)) return fail(400, 'bad_pow');

  if (!(await verifierMatches(env.PEPPER, b.proof, row.verifier, safeEqual))) {
    const n = await counterHit(env.DB, key, DAY);
    if (key48) await counterHit(env.DB, key48, DAY);
    await counterHit(env.DB, boxKey, DAY);
    return fail(403, 'wrong', { remaining: Math.max(0, LIMITS.unlockHumanPerIpPerBox - n) });
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE box_id = ? AND slot = ? AND role IN ('owner', 'admin', 'device')")
      .bind(id, row.slot),
    env.DB.prepare('INSERT INTO tokens (box_id, token_hash, role, slot, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, b.tokenHash, row.role, row.slot, Date.now()),
  ]);
  await touchSeen(env.DB, id, row.slot);
  return json({ role: row.role, slot: row.slot });
}

// 주소·장소 검색. 사용자 IP가 지도 업체로 가지 않도록 서버가 대신 묻는다.
// 카카오(국내 장소·주소에 강함, KAKAO_REST_KEY 필요)를 먼저 쓰고,
// 키가 없거나 카카오가 응답하지 않거나 결과가 없으면 해외 서버인 OpenStreetMap으로 넘어간다.
async function searchKakao(q, key) {
  const headers = { Authorization: `KakaoAK ${key}` };
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const get = async (kind) => {
    const res = await fetch(`${base}${kind}.json?size=6&query=${encodeURIComponent(q)}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`kakao ${res.status}`);
    return (await res.json()).documents;
  };
  let docs = await get('keyword');
  if (!docs.length) docs = await get('address');
  return docs.map((d) => ({
    name: d.place_name || d.address_name,
    address: d.road_address_name || d.address_name || d.road_address?.address_name || '',
    lat: +d.y,
    lng: +d.x,
  }));
}

async function searchOsm(q) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=6&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'findme/0.1 (https://findmeinkorea.com)', Referer: 'https://findmeinkorea.com' },
    cf: { cacheTtl: 86400, cacheEverything: true },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`osm ${res.status}`);
  return (await res.json()).map((r) => {
    const parts = r.display_name.split(',').map((x) => x.trim());
    const name = r.name || parts[0];
    // "합정역, 양화로, 합정동, 마포구, 서울특별시, 04027, 대한민국" → 이름 / "서울특별시 마포구 합정동 양화로"
    const rest = parts.filter((x, i) => !(i === 0 && x === name) && !/^\d{5}$/.test(x) && x !== '대한민국');
    return { name, address: rest.reverse().join(' '), lat: +r.lat, lng: +r.lon };
  });
}

async function geocode(request, env) {
  const b = await readBody(request);
  const q = typeof b?.q === 'string' ? b.q.trim().slice(0, 80) : '';
  if (q.length < 2) return fail(400, 'bad_request');
  const ip = await ipKey(request);
  if (await overIpLimit(env.DB, ip, (k) => `g:${k}:${Math.floor(Date.now() / HOUR)}`, HOUR, LIMITS.geocodePerIpPerHour)) {
    return fail(429, 'too_many');
  }
  if (env.KAKAO_REST_KEY) {
    try {
      const results = await searchKakao(q, env.KAKAO_REST_KEY);
      if (results.length) return json({ source: 'kakao', results });
    } catch (e) {
      console.warn('kakao search failed, falling back to osm:', e.message);
    }
  }
  try {
    return json({ source: 'osm', results: await searchOsm(q) });
  } catch {
    return fail(502, 'geocode_failed');
  }
}

// 받는 사람이 스팸·욕설 쪽지를 지운다. 답을 맞힌 사람(열쇠 access)만 할 수 있다.
// 출입문을 모두 떼어 누구도 다시 찾을 수 없게 하고, 쪽지 자체는 남겨 보낸 사람 기기에 "받는 사람이 지웠어요"로 보인다.
// 흔적 없이 없애지 않는 건, 쉬운 답을 맞힌 사칭범이 진짜 쪽지를 몰래 없애도 보낸 사람은 알 수 있게 하려는 것.
async function closeNote(id, request, env) {
  const b = await readBody(request);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  if (box.type !== 'note') return fail(400, 'bad_request');
  // 보낸 사람 기기로는 지울 수 없다 ("받는 사람이 지웠어요"가 거짓이 되지 않게)
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok?.role === 'owner') return fail(403, 'denied');
  if (box.closed_at) return json({ ok: true });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM doors WHERE box_id = ?').bind(id),
    env.DB.prepare('UPDATE boxes SET closed_at = ? WHERE id = ?').bind(Date.now(), id),
  ]);
  return json({ ok: true });
}

// 그룹장이 구성원을 추가할 때 새 출입문을 단다. 쪽지는 문을 더 달 일이 없다(스팸 쪽지를 여러 사람에게 꽂는 길이 되지 않게).
async function addDoors(id, request, env) {
  const b = await readBody(request, LIMITS.maxBodyCreate);
  const box = await checkAccess(env.DB, id, b?.access);
  if (!box) return fail(403, 'denied');
  if (box.type !== 'room') return fail(400, 'bad_request');
  const tok = await tokenInfo(env.DB, id, b.token);
  if (tok?.role !== 'admin' && tok?.role !== 'owner') return fail(403, 'denied');
  const doors = b.doors;
  if (!Array.isArray(doors) || !doors.length || doors.length > 20 ||
      !doors.every((d) => isHex(d?.door) && isStr(d?.teaser, 2000))) {
    return fail(400, 'bad_request');
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM doors WHERE box_id = ?').bind(id).first();
  if (count.n + doors.length > LIMITS.maxDoors * 2) return fail(429, 'too_many');
  const now = Date.now();
  await env.DB.batch(
    doors.map((d) =>
      env.DB.prepare('INSERT INTO doors (door_id, box_id, teaser, created_at) VALUES (?, ?, ?, ?)').bind(
        d.door, id, d.teaser, now
      )
    )
  );
  return json({ ok: true });
}

async function cleanup(env) {
  await env.DB.prepare('DELETE FROM counters WHERE exp < ?').bind(Date.now()).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!HOSTS.has(url.hostname)) {
      if (path.startsWith('/api/')) return fail(404, 'not_found');
      return Response.redirect(`https://findmeinkorea.com${path}${url.search}`, 301);
    }
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, 'not_found');

    try {
      // 차단 국가는 어떤 API도 열지 않는다 (DB를 건드리기 전에)
      const geo = region(request, env, url.hostname);
      if (geo === 'blocked') return fail(403, 'region');
      // 큰 본문은 읽기 전에 돌려보낸다 (DB도 건드리지 않는다). 길이를 안 알린 요청은 readBody가 읽으면서 센다
      if (Number(request.headers.get('content-length')) > bodyLimit(path)) return fail(413, 'too_large');
      if (Math.random() < 0.01) ctx.waitUntil(cleanup(env));
      if (request.method === 'GET' && path === '/api/stats') return await stats(request, env, ctx);
      if (request.method !== 'POST') return fail(405, 'method');
      const m = path.match(/^\/api\/box\/([A-Za-z0-9_-]{8,40})\/(read|post|device|invite|claim|recovery|recover|release|doors|close)$/);
      if (!m && !TOP.has(path)) return fail(404, 'not_found'); // 모르는 경로는 DB를 건드리지 않는다

      // 전역 서킷 브레이커: 요청이 몰리면 사람 확인을 거친 요청만 받는다. geocode는 자기 한도로 충분하다.
      // 사람 확인을 스스로 하는 경로(SELF_HUMAN)는 busy를 넘겨 자기 확인에 합치고, 나머지는 여기서 'busy' 토큰을 확인한다.
      // 토큰이 없으면 503 busy → 화면(api.js)이 사람 확인을 거쳐 한 번 다시 보낸다.
      const level = path === '/api/geocode' ? 0 : await loadLevel(env.DB);
      // 접속 신호는 사람 확인 없이 받는다(해외 접속도 세야 하니까). 요청이 몰리면 기록하지 않고 그냥 응답한다
      if (path === '/api/hello') return level >= 1 ? json({ ok: true }) : await hello(request, env);
      // 해외에서는 요청마다 사람 확인 (geocode도). 봇·VPN 자동화는 여기서 걸리고, 해외의 진짜 가족은 확인을 거쳐 쓸 수 있다
      const busy = geo === 'abroad' || level >= (path === '/api/find' ? 2 : 1);
      if (busy && !SELF_HUMAN.has(m ? m[2] : path)) {
        const b = await readBody(request, bodyLimit(path));
        if (!(await isHuman(env, b?.human, 'busy'))) return fail(503, 'busy', { retryAfter: LIMITS.busyRetry });
      }

      if (path === '/api/find') return await find(request, env, busy);
      if (path === '/api/box') return await createBox(request, env);
      if (path === '/api/unlock') return await unlock(request, env, busy);
      if (path === '/api/geocode') return await geocode(request, env);
      if (path === '/api/peek') return await peek(request, env);
      if (path === '/api/admin') return await adminStats(request, env);

      const [, id, action] = m;
      if (action === 'read') return await readBox(id, request, env);
      if (action === 'post') return await postEntry(id, request, env);
      if (action === 'device') return await registerDevice(id, request, env);
      if (action === 'invite') return await createInvite(id, request, env);
      if (action === 'claim') return await claimCode(id, request, env);
      if (action === 'recovery') return await setRecovery(id, request, env);
      if (action === 'recover') return await recover(id, request, env, busy);
      if (action === 'doors') return await addDoors(id, request, env);
      if (action === 'release') return await releaseSlot(id, request, env);
      if (action === 'close') return await closeNote(id, request, env);
      return fail(404, 'not_found');
    } catch (e) {
      console.error(e);
      return fail(500, 'server_error');
    }
  },
};
