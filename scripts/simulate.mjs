// 공격·전쟁 상황 시뮬레이션. 로컬 서버(npm run dev)에 실제 요청을 보내 결과를 확인한다.
// 사용: node scripts/simulate.mjs [http://localhost:8787]
// 로컬에서만 cf-connecting-ip 헤더로 여러 IP를 흉내 낸다. 실제 Cloudflare에서는 위조할 수 없다.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as C from '../public/js/crypto.js';

const BASE = process.argv[2] || 'http://localhost:8787';
const HUMAN = 'XXXX.DUMMY.TOKEN.XXXX'; // .dev.vars의 Turnstile 시험용 비밀 키는 항상 통과
// 하루 생성 한도는 IP별로 쌓이므로, 실행마다 다른 IP 대역을 쓴다
const IP_A = 1 + Math.floor(Math.random() * 250);
const IP_B = Math.floor(Math.random() * 200);
let ipSeq = 1;
const newIp = () => `10.${IP_A}.${IP_B + Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

async function call(path, body, ip = '10.9.9.9') {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const results = [];
function report(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? '✅ 막힘/정상' : '❌ 문제'}  ${id} ${title}${detail ? `\n      ${detail}` : ''}`);
}

// 쪽지 만들기 (write.js의 흐름과 같게)
async function createNote({ to, fromName, fromYmd, answer, teaserAt, human = HUMAN, raw = false, mutual = false, oldMutual = false }) {
  const box = await C.newBox(answer);
  const token = C.newToken();
  const ids = C.writerIdentities(to, fromName);
  if (fromYmd) ids.push(['sent', C.identity.sent(fromName, fromYmd)]);
  const teaser = { t: 'note', q: '우리만 아는 질문?', at: teaserAt || new Date().toISOString().slice(0, 7), ...(mutual ? { m: 1 } : {}) };
  const doors = await Promise.all(
    ids.map(async ([, s]) => {
      const d = await C.door(s);
      return { door: d.id, teaser: await C.seal(d.key, teaser) };
    })
  );
  // write.js와 같게: 맞쪽지의 "내가 보낸 쪽지" 문에는 질문을 담지 않는다
  if (mutual && fromYmd) doors.at(-1).teaser = await C.seal((await C.door(ids.at(-1)[1])).key, { t: 'note', at: teaser.at, m: 1 });
  const now = Date.now();
  const entries = [
    { ct: await C.seal(box.content, { k: 'header', note: { from: fromName, to: to.name }, ts: now }) },
    { ct: await C.seal(box.content, { k: 'post', name: fromName, text: '여기서 만나', place: { lat: 37.55, lng: 126.91, memo: '진짜 약속 장소' }, ts: now }) },
  ];
  const r = await call('/api/box', {
    type: 'note', salt: box.salt, verifier: box.verifier, wrapped: box.wrapped, accessHash: box.accessHash, doors,
    tokens: [{ hash: await C.sha256hex(token), role: 'owner', slot: 0 }],
    entries, human,
    ...(mutual
      ? {
          mutual: {
            want: (await C.door(C.identity.pair(fromName, to.name))).id,
            // oldMutual: 기기에 남은 예전 화면처럼 출생연도 조건 없이 보낸다
            ...(oldMutual ? {} : { wantYear: (await C.door(C.identity.year(fromName, fromYmd.slice(0, 4)))).id }),
            always: fromYmd ? [ids.length - 1] : [],
          },
        }
      : {}),
  }, newIp());
  if (raw) return r;
  if (r.status !== 200) throw new Error('create failed ' + JSON.stringify(r));
  return { id: r.data.id, box, token };
}

async function findAs(me, ip = newIp()) {
  const ids = C.searcherIdentities(me);
  const doors = await Promise.all(ids.map(async ([level, s]) => ({ level, ...(await C.door(s)) })));
  const r = await call('/api/find', { doors: doors.map((d) => d.id) }, ip);
  if (r.status !== 200) return { status: r.status, hits: [] };
  const hits = [];
  for (const row of r.data.results) {
    const d = doors.find((x) => x.id === row.door);
    hits.push({ ...row, level: d.level, teaser: await C.open(d.key, row.teaser) });
  }
  return { status: 200, hits };
}

async function tryAnswer(boxId, salt, answer, ip, human) {
  const { proof, wrap } = await C.quizKeys(answer, salt);
  const nonce = await C.proofOfWork(boxId, proof);
  const r = await call('/api/unlock', { box: boxId, proof, nonce, human }, ip);
  if (r.status === 200) return { ok: true, R: await C.unwrapBox(wrap, r.data.wrapped) };
  return { ok: false, ...r };
}

async function readAll(id, R, token) {
  const keys = await C.boxKeys(R);
  const r = await call(`/api/box/${id}/read`, { access: keys.access, token });
  const posts = [];
  for (const e of r.data?.entries || []) posts.push({ ...e, body: await C.open(keys.content, e.ct) });
  return { ...r.data, posts, keys };
}

// ---------------------------------------------------------------------------

const B = { name: '시뮬받는이', ymd: '19900315' };
const A = { name: '시뮬엄마', ymd: '19650101' };
const ANSWER = '우리집 강아지 초코';

console.log(`\n대상: ${BASE}\n`);
const note = await createNote({ to: { name: B.name, ymd: B.ymd }, fromName: A.name, fromYmd: A.ymd, answer: ANSWER });

// T1 이름·생일을 아는 제3자가 질문을 본다 (설계상 허용, 내용은 못 봄)
{
  const f = await findAs(B);
  const hit = f.hits.find((h) => h.box === note.id);
  report('T1', '이름+생일을 아는 제3자: 질문만 보이고 내용은 안 보임', !!hit && !hit.teaser.text && !hit.teaser.from,
    `보이는 것: ${JSON.stringify(hit?.teaser)}`);
}

// T2 답 무작위 대입: 같은 IP
{
  const ip = newIp();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await tryAnswer(note.id, note.box.salt, `틀린답${i}`, ip)).data?.error);
  // 대피소처럼 IP를 같이 쓰는 곳을 감안해 5번 뒤엔 사람 확인을 거쳐 30번까지
  let human = 0, last;
  for (let i = 6; i < 40 && last !== 'limit'; i++) {
    last = (await tryAnswer(note.id, note.box.salt, `틀린답${i}`, ip, HUMAN)).data?.error;
    if (last === 'wrong') human++;
  }
  report('T2', '같은 IP에서 답 대입: 5번 뒤엔 사람 확인, 30번 뒤엔 하루 차단', codes[5] === 'human' && human === 25 && last === 'limit',
    `처음 6번: ${codes.join(', ')} · 사람 확인 뒤 틀린 시도 ${human}번 → ${last}`);
}

// T3 IP를 바꿔 가며 대입 → 틀린 시도가 몰린 쪽지는 사람 확인 없이는 더 못 두드림
{
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await tryAnswer(note.id, note.box.salt, `분산공격${i}`, newIp())).data?.error);
  report('T3', 'IP를 바꿔 가며 대입: 일정 횟수 뒤엔 사람 확인 없이 시도 불가', codes.slice(-2).every((c) => c === 'human'),
    `응답: ${codes.join(', ')}`);
}

// T4 방해: 공격자가 계속 틀려도, 진짜 받는 사람은 사람 확인 후 열 수 있어야 한다
{
  let r = await tryAnswer(note.id, note.box.salt, ANSWER, newIp());
  const first = r.ok ? 'ok' : r.data?.error;
  if (!r.ok && first === 'human') r = await tryAnswer(note.id, note.box.salt, ANSWER, newIp(), HUMAN);
  report('T4', '공격이 몰린 쪽지를 진짜 받는 사람이 정답으로 열기', r.ok,
    r.ok ? `열림 (첫 응답: ${first} → 사람 확인 후 열림)` : `막힘: ${r.data?.error}`);
}

// 이후 테스트를 위해 대기 해제가 필요하면 새 쪽지로 진행
const note2 = await createNote({ to: { name: B.name, ymd: B.ymd }, fromName: A.name, answer: ANSWER, teaserAt: '2024-03' });
const opened = await tryAnswer(note2.id, note2.box.salt, ANSWER, newIp());

// T5 답을 아는 제3자가 "새 기기"로 장소를 바꿔 끼움
{
  const keys = await C.boxKeys(opened.R);
  await call(`/api/box/${note2.id}/post`, {
    access: keys.access, slot: 0,
    ct: await C.seal(keys.content, { k: 'post', name: A.name, text: '장소 바뀌었어, 여기로 와', place: { lat: 37.6, lng: 127.0, memo: '가짜 장소' }, ts: Date.now() }),
  });
  const d = await readAll(note2.id, opened.R);
  const placePosts = d.posts.filter((p) => p.body?.place);
  const shownNow = placePosts.filter((p) => p.badge === 'owner').at(-1); // box.js noteView 규칙: 보낸 사람 기기 글만
  report('T5', '답을 아는 제3자가 보낸 사람 이름으로 장소를 바꿔 끼움', shownNow.body.place.memo === '진짜 약속 장소',
    `화면의 "지금 약속 장소": ${shownNow.body.place.memo} / 끼워 넣은 글 배지: ${placePosts.at(-1).badge}`);
}

// T6 답을 아는 제3자가 보낸 사람 자리(slot 0)에 기기를 등록해 "방금 접속"을 꾸밈
{
  const keys = await C.boxKeys(opened.R);
  const fake = C.newToken();
  const reg = await call(`/api/box/${note2.id}/device`, { access: keys.access, tokenHash: await C.sha256hex(fake), slot: 0 });
  const post = await call(`/api/box/${note2.id}/post`, {
    access: keys.access, token: fake,
    ct: await C.seal(keys.content, { k: 'post', name: A.name, status: 'safe', text: '나 무사해', ts: Date.now() }),
  });
  report('T6', '보낸 사람 자리에 남의 기기 등록 → 생존 신호·✅ 배지 위조', reg.status !== 200,
    `기기 등록 ${reg.status}, 글 배지: ${post.data?.badge}`);
}

// T7 쪽지 만든 날짜 위조 (전쟁 전에 남긴 것처럼)
{
  const f = await findAs(B);
  const hit = f.hits.find((h) => h.box === note2.id);
  report('T7', '쪽지 날짜를 과거로 위조 (전쟁 전 쪽지처럼 보이게)', !!hit.created_at && new Date(hit.created_at).getFullYear() !== 2024,
    `쪽지에 적힌 날짜: ${hit.teaser.at} → 화면은 서버 기록 날짜를 씀 (${hit.created_at ? new Date(hit.created_at).toISOString().slice(0, 10) : '전달 안 됨'})`);
}

// T8 열쇠 없이 읽기
{
  const r1 = await call(`/api/box/${note2.id}/read`, {});
  const r2 = await call(`/api/box/${note2.id}/read`, { access: C.b64u.enc(C.rand(32)) });
  report('T8', '열쇠 없이/가짜 열쇠로 읽기', r1.status === 403 && r2.status === 403, `${r1.status}, ${r2.status}`);
}

// T9 복구 질문: 남이 만들기 / 틀린 답 대입 / 맞히면 잃어버린 폰 권한 끊기
{
  const keys = await C.boxKeys(opened.R);
  const RA = ['갤럭시S2', '김민지', '103동1202호'];
  const salt = C.b64u.enc(C.rand(16));
  const setBody = async (token, answers) => ({
    access: keys.access, token, salt, verifier: (await C.quizKeys(answers, salt)).proof,
    ct: await C.seal(keys.content, { q: ['폰?', '단짝?', '집?'] }),
  });
  // 답을 아는 제3자(토큰 없음/가짜 토큰)가 자기 답으로 복구 질문을 심기
  const fake = await call(`/api/box/${note2.id}/recovery`, await setBody(C.newToken(), ['a1', 'b1', 'c1']));
  report('T9a', '답을 아는 제3자가 복구 질문을 몰래 심기', fake.status === 403, `${fake.status}`);
  const set = await call(`/api/box/${note2.id}/recovery`, await setBody(note2.token, RA));

  const recoverTry = async (answers, ip, human) => {
    const { proof } = await C.quizKeys(answers, salt);
    const nonce = await C.proofOfWork(note2.id, proof);
    const token = C.newToken();
    const r = await call(`/api/box/${note2.id}/recover`, { access: keys.access, slot: 0, proof, nonce, tokenHash: await C.sha256hex(token), human }, ip);
    return { ...r, token };
  };
  const ip = newIp();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await recoverTry(['갤럭시S2', '김민지', 'x' + i], ip)).data?.error);
  report("T9b", "복구 질문 대입(두 개만 알고 하나 찍기): 5번 뒤엔 사람 확인 없이 시도 불가", set.status === 200 && codes[5] === "human", `만들기 ${set.status} ${JSON.stringify(set.data)} · 응답: ${codes.join(", ")}`);
  // 다른 IP에서 몰아치면 사람 확인
  const more = [];
  for (let i = 0; i < 6; i++) more.push((await recoverTry(['a', 'b', 'c' + i], newIp())).data?.error);
  report('T9c', 'IP를 바꿔 복구 질문 대입: 일정 횟수 뒤엔 사람 확인 필요', more.at(-1) === 'human', `응답: ${more.join(', ')}`);

  // 진짜 주인이 새 폰에서 세 답을 맞힘 (띄어쓰기·대소문자 달라도)
  const ok = await recoverTry(['갤럭시 s2', '김 민지', '103동 1202호'], newIp(), HUMAN);
  const ct = await C.seal(keys.content, { k: 'post', name: A.name, text: '새 폰', ts: Date.now() });
  const post = (token) => call(`/api/box/${note2.id}/post`, { access: keys.access, token, ct });
  const fresh = await post(ok.token);
  const old = await post(note2.token);
  report('T9d', '세 답을 맞히면 새 폰이 보낸 사람이 되고 잃어버린 폰은 끊김',
    ok.data?.role === 'owner' && fresh.data?.badge === 'owner' && old.data?.badge !== 'owner',
    `되찾기: ${ok.status} ${ok.data?.role} · 새 폰 배지 ${fresh.data?.badge} · 잃어버린 폰 배지 ${old.data?.badge}`);
}

// T10 이름+생일 무작위 조회(누가 쪽지를 받았는지 훑기)
{
  const ip = newIp();
  let last;
  for (let i = 0; i < 42; i++) last = await call('/api/find', { doors: [await C.sha256hex('x' + i)] }, ip);
  report('T10', '이름+생일 대량 조회 (사람 확인 없는 프로그램)', last.status === 403 && last.data?.error === 'human', `41번째 이후: ${last.status} ${last.data?.error}`);
}

// T11 음력/양력 생일 혼동: 쓴 사람은 양력, 받는 사람은 음력으로 검색
{
  const lunar = await createNote({ to: { name: '음력받는이', ymd: '19900315' }, fromName: '양력엄마', answer: ANSWER });
  const f = await findAs({ name: '음력받는이', ymd: '19900218' });
  report('T11', '음력/양력 생일이 달라도 찾기', f.hits.some((h) => h.box === lunar.id),
    f.hits.some((h) => h.box === lunar.id) ? '찾음' : '못 찾음 (정확한 생일 출입문만 있음)');
}

// T12 Turnstile 없이 쪽지 대량 생성
{
  const r = await createNote({ to: B, fromName: '봇', answer: 'x', human: null, raw: true });
  report('T12', '사람 확인(Turnstile) 없이 쪽지 만들기', r.status === 403, `${r.status} ${r.data?.error}`);
}

// ---- 맞쪽지 ----
// 실행마다 새 이름을 써서 이전 실행의 쪽지와 섞이지 않게
const RUN = Date.now().toString(36);
const S = { name: `맞쪽지민수${RUN}`, ymd: '19980101' };
const R = { name: `맞쪽지지은${RUN}`, ymd: '19990202' };
const has = async (me, id) => (await findAs(me)).hits.find((h) => h.box === id);

const secret = await createNote({ to: { name: R.name, ymd: R.ymd }, fromName: S.name, fromYmd: S.ymd, answer: ANSWER, mutual: true, raw: true });
const secretId = secret.data.id;

// M1 숨어 있는 동안: 받는 사람도, 받는 사람 정보를 아는 남도 못 봄. 보낸 사람은 자기 문으로 상태 확인
{
  const toR = await has(R, secretId);
  const own = await has(S, secretId);
  report('M1', '맞쪽지는 상대가 쓰기 전까지 받는 사람 검색에 안 보임 (보낸 사람만 상태 확인)', !toR && own?.hidden === 1,
    `받는 사람 검색: ${toR ? '보임' : '안 보임'} / 보낸 사람 검색: ${own ? `보임 (숨김=${own.hidden})` : '안 보임'}`);
}
// M2 만든 응답에 숨김 여부가 없어야 함 (흉내 내서 떠보기 방지)
report('M2', '쪽지 만들기 응답으로 숨김 여부를 떠볼 수 없음', Object.keys(secret.data).join() === 'id', `응답 키: ${Object.keys(secret.data).join(', ')}`);

// M3 제3자가 받는 사람에게 쪽지를 써도 안 열림
{
  await createNote({ to: { name: R.name, ymd: R.ymd }, fromName: '다른사람', answer: ANSWER });
  report('M3', '다른 사람이 받는 사람에게 쪽지를 써도 맞쪽지는 그대로 숨음', !(await has(R, secretId)));
}
// M4 받는 사람이 보낸 사람에게 쪽지를 쓰는 순간 열림
let reply;
{
  reply = await createNote({ to: { name: S.name, year: S.ymd.slice(0, 4) }, fromName: R.name, answer: '다른 답' });
  const nowR = await has(R, secretId);
  const nowS = await has(S, reply.id);
  report('M4', '받는 사람이 보낸 사람에게 쪽지를 쓰면 서로의 쪽지가 나타남', !!nowR && !!nowS,
    `받는 사람 쪽에 맞쪽지: ${nowR ? '보임' : '안 보임'} / 보낸 사람 쪽에 답장: ${nowS ? '보임' : '안 보임'}`);
}
// M5 열려도 내용은 답을 알아야
{
  const r = await tryAnswer(secretId, secret ? (await has(R, secretId)).salt : '', '틀린답', newIp());
  report('M5', '맞쪽지가 열려도 내용은 질문의 답을 알아야 볼 수 있음', !r.ok, `틀린 답: ${r.data?.error}`);
}
// M6 둘 다 맞쪽지: 두 번째가 쓰는 순간 둘 다 열림
{
  const P = { name: `쌍방영희${RUN}`, ymd: '19950505' };
  const Q = { name: `쌍방철수${RUN}`, ymd: '19940404' };
  const a = await createNote({ to: { name: Q.name, ymd: Q.ymd }, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  const before = await has(Q, a.id);
  const b = await createNote({ to: { name: P.name, ymd: P.ymd }, fromName: Q.name, fromYmd: Q.ymd, answer: ANSWER, mutual: true });
  const ok = !before && (await has(Q, a.id)) && (await has(P, b.id));
  report('M6', '둘 다 맞쪽지를 쓰면 두 번째가 쓰는 순간 둘 다 나타남', !!ok, `첫 쪽지 처음엔 ${before ? '보임(문제)' : '숨음'} → 둘 다 ${ok ? '보임' : '문제'}`);
}

// M7 받는 사람이 보낸 사람의 이름만 알고 답장하면 안 열리고, 출생연도까지 알고 쓰면 열림
{
  const P = { name: `연도민호${RUN}`, ymd: '19970707' };
  const Q = { name: `연도수아${RUN}`, ymd: '19980808' };
  const a = await createNote({ to: { name: Q.name, year: '1998' }, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  await createNote({ to: { name: P.name }, fromName: Q.name, answer: '다른 답' });
  const nameOnly = await has(Q, a.id);
  await createNote({ to: { name: P.name, md: '0707' }, fromName: Q.name, answer: '다른 답' });
  const mdOnly = await has(Q, a.id);
  await createNote({ to: { name: P.name, year: '1997' }, fromName: Q.name, answer: '다른 답' });
  const withYear = await has(Q, a.id);
  report('M7', '보낸 사람 이름만(또는 생일 월·일만) 알고 답장하면 안 열리고, 출생연도까지 알면 열림',
    !nameOnly && !mdOnly && !!withYear,
    `이름만: ${nameOnly ? '열림(문제)' : '숨음'} · 월·일만: ${mdOnly ? '열림(문제)' : '숨음'} · 출생연도까지: ${withYear ? '열림' : '숨음(문제)'}`);
}
// M8 띄어쓰기·영문 대소문자가 달라도 열림
{
  const a = await createNote({ to: { name: `이 서연${RUN}`, ymd: '19960606' }, fromName: `Kim Minjun${RUN}`, fromYmd: '19950505', answer: ANSWER, mutual: true });
  await createNote({ to: { name: `kimminjun${RUN}`, ymd: '19950505' }, fromName: `이서연${RUN}`, answer: '다른 답' });
  report('M8', '"이 서연"↔"이서연", "Kim Minjun"↔"kimminjun"처럼 띄어쓰기·대소문자가 달라도 열림',
    !!(await has({ name: `이서연${RUN}`, ymd: '19960606' }, a.id)));
}
// M9 두 사람이 거의 동시에 맞쪽지를 쓰면 (예전엔 둘 다 서로를 못 보고 한쪽이 영영 숨을 수 있었다)
{
  let stuck = 0;
  for (let k = 0; k < 5; k++) {
    const P = { name: `동시가${k}${RUN}`, ymd: '19930303' };
    const Q = { name: `동시나${k}${RUN}`, ymd: '19940404' };
    const [a, b] = await Promise.all([
      createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true }),
      createNote({ to: P, fromName: Q.name, fromYmd: Q.ymd, answer: ANSWER, mutual: true }),
    ]);
    if (!(await has(Q, a.id)) || !(await has(P, b.id))) stuck++;
  }
  report('M9', '두 사람이 동시에 맞쪽지를 써도 둘 다 열림 (5번 반복)', stuck === 0, `한쪽이 숨은 채 남은 경우 ${stuck}번`);
}
// M10 보낸 사람의 이름·생일을 아는 남: 숨은 맞쪽지의 질문을 못 보고, 답을 알아도 못 엶
{
  const P = { name: `숨김보낸${RUN}`, ymd: '19920202' };
  const Q = { name: `숨김받는${RUN}`, ymd: '19910101' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  const own = await has(P, a.id);
  const r = own ? await tryAnswer(a.id, own.salt, ANSWER, newIp()) : { ok: false };
  report('M10', '보낸 사람 이름·생일을 아는 남: 숨은 맞쪽지의 질문이 안 보이고, 정답을 알아도 열리지 않음',
    !!own && own.teaser.q === undefined && !r.ok && r.data?.error === 'hidden',
    `상태: ${own ? `숨김=${own.hidden}` : '안 보임'} · 질문: ${own?.teaser.q ?? '없음'} · 정답 넣으면: ${r.ok ? '열림(문제)' : r.data?.error}`);
}
// M11 받는 사람이 먼저 써 둔 뒤에 맞쪽지를 쓰면 처음부터 보임
{
  const P = { name: `먼저씀가${RUN}`, ymd: '19900909' };
  const Q = { name: `먼저씀나${RUN}`, ymd: '19891010' };
  await createNote({ to: P, fromName: Q.name, answer: '다른 답' });
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  report('M11', '상대가 이미 나에게 쪽지를 써 두었으면 맞쪽지가 처음부터 보임', !!(await has(Q, a.id)));
}
// M12 이름이 다르게 적히면(성 빼고 "서연") 열리지 않음 — 남의 쪽지로 잘못 열리지 않게 이름은 그대로 맞춘다
{
  const P = { name: `김성포함${RUN}`, ymd: '19880808' };
  const Q = { name: `이성포함${RUN}`, ymd: '19870707' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  await createNote({ to: { name: `성포함${RUN}`, year: '1988' }, fromName: Q.name, answer: '다른 답' });
  report('M12', '상대가 내 이름을 다르게(성 빼고) 적으면 열리지 않음 (그래서 쓰기 화면에서 성까지 똑같이 적으라고 안내)',
    !(await has(Q, a.id)));
}
// M13 남이 받는 사람인 척 보낸 사람에게 쪽지를 쓰면: 이름만 알면 안 풀리고,
//     출생연도까지 알아 풀더라도 내용은 답을 알아야 볼 수 있음
{
  const P = { name: `흉내보낸${RUN}`, ymd: '19860606' };
  const Q = { name: `흉내받는${RUN}`, ymd: '19850505' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  await createNote({ to: { name: P.name }, fromName: Q.name, answer: '가짜' });
  const byName = await has({ name: Q.name, ymd: '20000101', fromName: P.name }, a.id);
  await createNote({ to: { name: P.name, year: '1986' }, fromName: Q.name, answer: '가짜' });
  const seen = await has({ name: Q.name, ymd: '20000101', fromName: P.name }, a.id);
  const r = seen ? await tryAnswer(a.id, seen.salt, '아무거나', newIp()) : { ok: false };
  report('M13', '이름만 흉내 내면 숨김이 안 풀리고, 출생연도까지 알아 풀어도 답을 모르면 내용은 못 봄', !byName && !r.ok,
    `이름만 흉내: ${byName ? '풀림(문제)' : '숨음'} · 출생연도까지 흉내: ${seen ? '풀림' : '숨음'} · 틀린 답: ${r.data?.error ?? '-'}`);
}
// M14 동명이인: 다른 "받는 사람"이 다른 "보낸 사람"(출생연도가 2년 넘게 다른 동명이인)에게 쓴 쪽지로는 안 열림
{
  const P = { name: `흔한민준${RUN}`, ymd: '19950101' };
  const Q = { name: `흔한서연${RUN}`, ymd: '19960101' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  // 다른 서연이 자기 오빠 민준(1988년생)에게 쓴 쪽지
  await createNote({ to: { name: P.name, ymd: '19880303' }, fromName: Q.name, answer: '다른 답' });
  const other = await has(Q, a.id);
  report('M14', '동명이인끼리(출생연도가 2년 넘게 다름) 쓴 쪽지로는 맞쪽지가 안 열림', !other, other ? '열림(문제)' : '숨음');
}
// M15 빠른년생·나이 착각: 받는 사람이 보낸 사람 출생연도를 1년 틀려도 열림, 2년 틀리면 안 열림
{
  const P = { name: `빠른년생${RUN}`, ymd: '19950220' };
  const Q = { name: `빠른친구${RUN}`, ymd: '19940505' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true });
  await createNote({ to: { name: P.name, year: '1993' }, fromName: Q.name, answer: '다른 답' });
  const off2 = await has(Q, a.id);
  await createNote({ to: { name: P.name, year: '1994' }, fromName: Q.name, answer: '다른 답' });
  const off1 = await has(Q, a.id);
  report('M15', '출생연도를 1년 틀려도 열리고(빠른년생), 2년 틀리면 안 열림', !off2 && !!off1,
    `2년 틀림: ${off2 ? '열림(문제)' : '숨음'} · 1년 틀림: ${off1 ? '열림' : '숨음(문제)'}`);
}
// M16 예전 화면으로 만든 맞쪽지(출생연도 조건 없음)는 예전처럼 이름끼리 열림
{
  const P = { name: `옛맞쪽가${RUN}`, ymd: '19920909' };
  const Q = { name: `옛맞쪽나${RUN}`, ymd: '19930303' };
  const a = await createNote({ to: Q, fromName: P.name, fromYmd: P.ymd, answer: ANSWER, mutual: true, oldMutual: true });
  await createNote({ to: { name: P.name }, fromName: Q.name, answer: '다른 답' });
  report('M16', '예전 화면으로 만든 맞쪽지(출생연도 조건 없음)도 그대로 열림', !!(await has({ ...Q, fromName: P.name }, a.id)));
}

// ---------- 전쟁 상황 (대피소·통신망·운영) ----------
// W1 대피소: 수백 명이 와이파이 하나(같은 IP)로 찾기
{
  const ip = newIp();
  let blocked = 0;
  for (let i = 0; i < 45; i++) {
    const r = await call('/api/find', { doors: [await C.sha256hex('shelter' + i)] }, ip);
    if (r.status !== 200) blocked++;
  }
  const withHuman = await call('/api/find', { doors: [await C.sha256hex('shelter-h')], human: HUMAN }, ip);
  report('W1', '대피소 한 와이파이에서 45명이 찾기: 사람 확인만 거치면 계속 찾을 수 있음', withHuman.status === 200,
    `제한에 걸린 찾기 ${blocked}번 → 사람 확인 후: ${withHuman.status} ${withHuman.data?.error || ''}`);
}

// W2 한 인터넷 연결(IP)에서 하루 50개까지만 만들기 (사람 확인은 매번 통과)
async function rawCreate(ip, tag) {
  const box = await C.newBox('답답답');
  const d = await C.door(`limit-note-${tag}-${Math.random()}`);
  return call('/api/box', {
    type: 'note', salt: box.salt, verifier: box.verifier, wrapped: box.wrapped, accessHash: box.accessHash,
    doors: [{ door: d.id, teaser: await C.seal(d.key, { t: 'note', q: 'q' }) }],
    tokens: [{ hash: await C.sha256hex(C.newToken()), role: 'owner', slot: 0 }],
    entries: [{ ct: await C.seal(box.content, { k: 'header', note: { from: 'a', to: 'b' }, ts: 1 }) }], human: HUMAN,
  }, ip);
}
{
  const ip = newIp();
  let ok = 0, last;
  for (let i = 0; i < 52; i++) {
    last = await rawCreate(ip, i);
    if (last.status === 200) ok++;
  }
  report('W2', '한 IP에서 하루 50개까지 만들고, 51번째부터 "내일 다시" 응답', ok === 50 && last.data?.error === 'create_limit',
    `성공 ${ok}/52 · 마지막 응답 ${last.status} ${last.data?.error || ''}`);
}

// W6 IPv6: 같은 /64 대역 안에서 주소만 바꿔도 한 사람으로 센다
{
  const prefix = `2001:db8:${(Date.now() % 65535).toString(16)}:${(ipSeq++).toString(16)}`;
  let ok = 0, last;
  for (let i = 0; i < 52; i++) {
    last = await rawCreate(`${prefix}::${(i + 1).toString(16)}`, `v6-${i}`);
    if (last.status === 200) ok++;
  }
  const other = await rawCreate(`${prefix.replace(/:[0-9a-f]+$/, ':ffff')}::1`, 'v6-other');
  report('W6', 'IPv6 주소를 바꿔 가며 만들어도 같은 /64면 50개에서 막힘, 다른 /64는 따로', ok === 50 && last.data?.error === 'create_limit' && other.status === 200,
    `같은 대역 성공 ${ok}/52 · 다른 대역 ${other.status}`);
}

// W3 답을 아는 사람이 글 수백 개로 도배 → 보낸 사람이 새로 올린 장소가 화면에서 밀려나는지
{
  const n = await createNote({ to: { name: B.name, ymd: B.ymd }, fromName: A.name, answer: ANSWER });
  const keys = await C.boxKeys(n.box.R);
  const junk = await C.seal(keys.content, { k: 'post', name: A.name, text: '도배', ts: Date.now() });
  let accepted = 0;
  for (let i = 0; i < 520; i++) {
    const r = await call(`/api/box/${n.id}/post`, { access: keys.access, ct: junk, slot: 1 }, `10.77.${Math.floor(i / 200)}.${(i % 200) + 1}`);
    if (r.status === 200) accepted++;
  }
  await call(`/api/box/${n.id}/post`, {
    access: keys.access, token: n.token,
    ct: await C.seal(keys.content, { k: 'post', name: A.name, text: '장소 바꿈', place: { memo: '새 약속 장소' }, ts: Date.now() }),
  });
  const view = await readAll(n.id, n.box.R);
  const hasHeader = view.posts.some((p) => p.body?.k === 'header');
  const hasNew = view.posts.some((p) => p.body?.place?.memo === '새 약속 장소');
  report('W3', '도배 글 520개 뒤에도 쪽지 머리말과 보낸 사람의 새 장소가 보임', hasHeader && hasNew,
    `받아들인 도배 글 ${accepted}개 · 머리말 ${hasHeader ? '보임' : '안 보임'} · 새 장소 ${hasNew ? '보임' : '안 보임'}`);
}

// W4 답을 아는 남이 받는 사람 자리를 먼저 차지(기억된 기기) → 보낸 사람이 풀어 줄 수 있는지
{
  const n = await createNote({ to: { name: B.name, ymd: B.ymd }, fromName: A.name, answer: ANSWER });
  const keys = await C.boxKeys(n.box.R);
  const squatter = C.newToken();
  const sq = await call(`/api/box/${n.id}/device`, { access: keys.access, slot: 1, tokenHash: await C.sha256hex(squatter) }, newIp());
  const rel = await call(`/api/box/${n.id}/release`, { access: keys.access, token: n.token, slot: 1 });
  const real = C.newToken();
  const reg = await call(`/api/box/${n.id}/device`, { access: keys.access, slot: 1, tokenHash: await C.sha256hex(real) }, newIp());
  const p = await call(`/api/box/${n.id}/post`, { access: keys.access, token: squatter, ct: await C.seal(keys.content, { k: 'post', name: B.name, text: 'x', ts: 1 }) });
  // 받는 사람(기억된 기기)은 남의 자리를 풀 수 없어야 함
  const abuse = await call(`/api/box/${n.id}/release`, { access: keys.access, token: real, slot: 0 });
  report('W4', '받는 사람 자리를 먼저 차지한 기기를 보낸 사람이 풀어 줌', sq.status === 200 && rel.status === 200 && reg.status === 200 && p.data?.badge === 'new' && abuse.status === 403,
    `차지 ${sq.status} → 풀기 ${rel.status} → 진짜 받는 사람 ${reg.status} · 차지했던 기기 배지 ${p.data?.badge} · 받는 사람이 보낸 사람 자리 풀기 ${abuse.status}`);
}

// W5 답의 띄어쓰기: 붙여 써도, 띄어 써도, 복사해 온 보이지 않는 공백이 있어도 열림
{
  const n = await createNote({ to: { name: B.name, ymd: B.ymd }, fromName: A.name, answer: '떡볶이 집' });
  const tries = ['떡볶이집', '떡 볶 이 집', '떡볶이​집', '떡볶이　집'];
  const ok = [];
  for (const t of tries) ok.push((await tryAnswer(n.id, n.box.salt, t, newIp())).ok);
  report('W5', "답 '떡볶이 집'을 붙여 쓰거나 다르게 띄어 써도 열림", ok.every(Boolean), `결과: ${ok.join(', ')}`);
}

// W7 흔한 이름+출생연도로 쪽지 45개를 뿌려도, 생일까지 맞는 진짜 쪽지가 찾기 결과에서 밀려나지 않음
{
  const me = { name: `흔한이름${Date.now() % 100000}`, ymd: '19950505' };
  const real = await createNote({ to: { name: me.name, ymd: me.ymd }, fromName: A.name, answer: ANSWER });
  for (let i = 0; i < 45; i++) await createNote({ to: { name: me.name, year: '1995' }, fromName: `스팸${i}`, answer: '아무거나' });
  const f = await findAs(me);
  const hit = f.hits.find((h) => h.box === real.id);
  report('W7', '이름+출생연도 스팸 45개 뒤에도 생일이 맞는 진짜 쪽지가 결과에 들어옴', !!hit && f.hits[0]?.box === real.id,
    `결과 ${f.hits.length}개 · 진짜 쪽지 ${hit ? `${f.hits.findIndex((h) => h.box === real.id) + 1}번째` : '없음'}`);
}

// W8 받는 사람이 답을 맞힌 뒤 쪽지 지우기 → 찾기에서 사라지고, 답장은 막히고, 보낸 사람에게는 "지웠어요"
{
  const to = { name: `지울받는이${Date.now() % 100000}`, ymd: '19920202' };
  const n = await createNote({ to, fromName: A.name, answer: ANSWER });
  const keys = await C.boxKeys(n.box.R);
  const byOwner = await call(`/api/box/${n.id}/close`, { access: keys.access, token: n.token });
  const noKey = await call(`/api/box/${n.id}/close`, { access: 'x'.repeat(43) });
  const opened = await tryAnswer(n.id, n.box.salt, ANSWER, newIp());
  const close = await call(`/api/box/${n.id}/close`, { access: (await C.boxKeys(opened.R)).access });
  const f = await findAs(to);
  const post = await call(`/api/box/${n.id}/post`, { access: keys.access, ct: 'x', slot: 1 });
  const sender = await readAll(n.id, n.box.R, n.token);
  report('W8', '답을 맞힌 받는 사람만 지울 수 있고, 지우면 찾기에서 사라지고 보낸 사람은 알 수 있음',
    byOwner.status === 403 && noKey.status === 403 && close.status === 200 && !f.hits.some((h) => h.box === n.id) && post.status === 410 && !!sender.closed,
    `보낸 사람 기기로 지우기 ${byOwner.status} · 열쇠 없이 ${noKey.status} · 받는 사람 ${close.status} · 찾기에 ${f.hits.some((h) => h.box === n.id) ? '남음' : '없음'} · 답장 ${post.status} · 보낸 사람 화면 closed=${!!sender.closed}`);
}

// ---------------------------------------------------------------------------
// S: 보안 점검 1순위 (docs/security-plan.md H2·M9·M12·L18). 직접 만든 요청으로 서버의 검사를 확인한다

const hex32 = () => [...C.rand(32)].map((b) => b.toString(16).padStart(2, '0')).join('');

// S1 정식 주소 밖(workers.dev 등)에서 온 API 요청은 열리지 않음.
// 로컬 wrangler dev는 Host를 localhost로 바꿔 버려서, 워커 코드를 직접 불러 확인한다
{
  const worker = (await import('../src/worker.js')).default;
  const ctx = { waitUntil() {} };
  const api = await worker.fetch(new Request('https://findme.evil.workers.dev/api/stats'), {}, ctx);
  const page = await worker.fetch(new Request('https://findme.evil.workers.dev/about?x=1'), {}, ctx);
  report('S1', '정식 주소가 아닌 호스트: API는 404, 화면은 정식 주소로 301',
    api.status === 404 && page.status === 301 && page.headers.get('location') === 'https://findmeinkorea.com/about?x=1',
    `API ${api.status} · 화면 ${page.status} → ${page.headers.get('location')}`);
}

// S2 큰 본문: 길이를 알린 요청은 읽기 전에 413. 길이를 안 알린(chunked) 요청은 읽다가 한도에서 끊어 거절
{
  const pad = 'x'.repeat(300_000);
  const find = await call('/api/find', { doors: [], pad });
  const create = await call('/api/box', { pad });
  const chunked = await fetch(BASE + '/api/find', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': newIp() },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"doors":[],"pad":"${'x'.repeat(100_000)}"}`));
        c.close();
      },
    }),
    duplex: 'half',
  });
  report('S2', '300KB 본문은 413, 길이를 알리지 않은 100KB 본문도 거절',
    find.status === 413 && create.status === 413 && [400, 413].includes(chunked.status),
    `찾기 ${find.status} · 만들기 ${create.status} · 길이 없는 요청 ${chunked.status}`);
}

// S3 쪽지는 문 8개까지, 가족방은 60개까지. 한 쪽지를 수십 명에게 꽂지 못하게
{
  const box = await C.newBox('문개수시험');
  const tokenHash = await C.sha256hex(C.newToken());
  const payload = (type, n, slot = 0) => ({
    type, salt: box.salt, verifier: box.verifier, wrapped: box.wrapped, accessHash: box.accessHash,
    doors: Array.from({ length: n }, () => ({ door: hex32(), teaser: 'x' })),
    tokens: [{ hash: tokenHash, role: type === 'note' ? 'owner' : 'admin', slot }],
    entries: [{ ct: 'x' }], human: HUMAN,
  });
  const nine = await call('/api/box', payload('note', 9), newIp());
  const eight = await call('/api/box', payload('note', 8), newIp());
  const roomNine = await call('/api/box', payload('room', 9), newIp());
  const slot100 = await call('/api/box', payload('note', 1, 100), newIp());
  const slotNeg = await call('/api/box', payload('note', 1, -1), newIp());
  report('S3', '쪽지 문 9개는 400, 8개는 통과, 가족방 9개는 통과, 자리 100·-1은 400',
    nine.status === 400 && eight.status === 200 && roomNine.status === 200 && slot100.status === 400 && slotNeg.status === 400,
    `쪽지 9개 ${nine.status} · 8개 ${eight.status} · 가족방 9개 ${roomNine.status} · 자리 100 ${slot100.status} · 자리 -1 ${slotNeg.status}`);
}

// S4 쪽지에는 문을 더 달 수 없음(보낸 사람 기기라도). 새 기기 글의 자리 값이 범위를 벗어나면 비움
{
  const keys = await C.boxKeys(note.box.R);
  const doors = await call(`/api/box/${note.id}/doors`, { access: keys.access, token: note.token, doors: [{ door: hex32(), teaser: 'x' }] });
  const post = await call(`/api/box/${note.id}/post`, { access: keys.access, ct: await C.seal(keys.content, { k: 'post', name: '자리시험', ts: Date.now() }), slot: 100 });
  const all = await readAll(note.id, note.box.R, note.token);
  const last = all.entries.find((e) => e.id === post.data?.id);
  report('S4', '쪽지에 문 추가는 400, 자리 100으로 올린 새 기기 글은 자리 없음으로 저장',
    doors.status === 400 && post.status === 200 && last && last.slot === null,
    `문 추가 ${doors.status} · 글 ${post.status} · 저장된 자리 ${last?.slot}`);
}

// S5 IPv6 /48 대역: /64를 바꿔 가며 찾아도 /64 한도(40)의 8배(320)에서 사람 확인을 요구. 다른 /48은 영향 없음
{
  const doors = (await Promise.all(C.searcherIdentities(B).map(([, s]) => C.door(s)))).map((d) => d.id);
  const site = Date.now() % 0xfff0; // 실행마다 다른 /48
  const v6 = (s, i, j) => `2001:db8:${s.toString(16)}:${i.toString(16)}::${j.toString(16)}`;
  let ok = 0, first = -1, n = 0;
  for (let i = 1; i <= 9 && first < 0; i++) {
    for (let j = 1; j <= 36 && first < 0; j++, n++) {
      const r = await call('/api/find', { doors }, v6(site, i, j));
      if (r.status === 200) ok++;
      else if (r.data?.error === 'human') first = n;
    }
  }
  const other = await call('/api/find', { doors }, v6(site + 1, 1, 1));
  report('S5', 'IPv6 /48 대역: /64 9개 × 36번 찾기는 320번째까지 통과, 321번째부터 사람 확인. 다른 /48은 정상',
    ok === 320 && first === 320 && other.status === 200,
    `통과 ${ok} · 사람 확인 요구 시작 ${first + 1}번째 · 다른 /48 ${other.status}`);
}

// S6 쪽지 열기(/read)는 IP마다 시간당 300번까지, 301번째부터 429 (화면은 저장본을 보여 준다)
{
  const keys = await C.boxKeys(note.box.R);
  const ip = newIp();
  let ok = 0, last;
  for (let i = 0; i < 302; i++) {
    last = await call(`/api/box/${note.id}/read`, { access: keys.access }, ip);
    if (last.status === 200) ok++;
  }
  report('S6', '같은 IP에서 쪽지 열기 300번까지, 301번째부터 429', ok === 300 && last.status === 429,
    `성공 ${ok}/302 · 마지막 ${last.status} ${last.data?.error || ''}`);
}

// S7 기억된 기기(보낸 사람)의 글도 방마다 하루 300개까지 (훔친 기기로 도배 방지)
{
  const n = await createNote({ to: { name: '도배받는이', ymd: '19880808' }, fromName: '도배하는이', answer: ANSWER });
  const keys = await C.boxKeys(n.box.R);
  const ct = await C.seal(keys.content, { k: 'post', name: '도배하는이', text: 'x', ts: Date.now() });
  const ip = newIp();
  let ok = 0, last;
  for (let i = 0; i < 302; i++) {
    last = await call(`/api/box/${n.id}/post`, { access: keys.access, token: n.token, ct }, ip);
    if (last.status === 200) ok++;
  }
  report('S7', '기억된 기기의 글도 하루 300개까지, 301번째부터 box_busy', ok === 300 && last.data?.error === 'box_busy',
    `성공 ${ok}/302 · 마지막 ${last.status} ${last.data?.error || ''}`);
}

// S8 전역 서킷 브레이커: 표본 카운터(all:{hour}, 50배로 추정)를 직접 올려 요청이 몰린 상황을 흉내 낸다.
// 추정 3,000/시 초과 → find 빼고 사람 확인(없으면 503 busy), 5,000/시 초과 → find도 사람 확인
{
  const hour = Math.floor(Date.now() / 3_600_000);
  const seed = (n) =>
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'findme', '--local', '--command',
      n === null
        ? `DELETE FROM counters WHERE k = 'all:${hour}'`
        : `INSERT INTO counters (k, n, exp) VALUES ('all:${hour}', ${n}, ${Date.now() + 3_600_000})
           ON CONFLICT(k) DO UPDATE SET n = ${n}, exp = ${Date.now() + 3_600_000}`,
    ], { stdio: 'ignore', cwd: new URL('..', import.meta.url).pathname });
  const keys = await C.boxKeys(note.box.R);
  const doors = (await Promise.all(C.searcherIdentities(B).map(([, s]) => C.door(s)))).map((d) => d.id);
  const read = (human) => call(`/api/box/${note.id}/read`, { access: keys.access, human }, newIp());
  const find = (human) => call('/api/find', { doors, human }, newIp());
  let soft, hard;
  try {
    seed(61); // 61 × 50 = 3,050 > 3,000
    soft = { read: await read(), readHuman: await read(HUMAN), find: await find(), stats: await call('/api/stats') };
    seed(101); // 5,050 > 5,000
    hard = { find: await find(), findHuman: await find(HUMAN) };
  } finally {
    seed(null);
  }
  const after = await read();
  report('S8', '요청이 몰리면: 열기는 사람 확인 없이는 503 busy(retryAfter), 확인하면 통과, 찾기·stats는 정상 → 더 몰리면 찾기도 사람 확인. 풀리면 정상',
    soft.read.status === 503 && soft.read.data?.error === 'busy' && soft.read.data?.retryAfter > 0 &&
      soft.readHuman.status === 200 && soft.find.status === 200 && soft.stats.status === 200 &&
      hard.find.status === 403 && hard.find.data?.error === 'human' && hard.findHuman.status === 200 && after.status === 200,
    `3천 초과: 열기 ${soft.read.status} ${soft.read.data?.error || ''}(retryAfter ${soft.read.data?.retryAfter}) · 확인 뒤 ${soft.readHuman.status} · 찾기 ${soft.find.status} · stats ${soft.stats.status}` +
      ` / 5천 초과: 찾기 ${hard.find.status} ${hard.find.data?.error || ''} · 확인 뒤 ${hard.findHuman.status} / 풀린 뒤 ${after.status}`);
}

// S9 새 소식 확인(/peek): 내 글만 있으면 0, 남(새 기기)이 글을 남기면 그 시각이 생김, 열쇠가 틀린 방은 빠짐, 21개는 400
{
  const n = await createNote({ to: { name: '소식받는이', ymd: '19910101' }, fromName: '소식보낸이', answer: ANSWER });
  const keys = await C.boxKeys(n.box.R);
  const mine = { id: n.id, access: keys.access, token: n.token };
  const before = await call('/api/peek', { boxes: [mine] }, newIp());
  const ct = await C.seal(keys.content, { k: 'post', name: '남', text: '새 글', ts: Date.now() });
  await call(`/api/box/${n.id}/post`, { access: keys.access, ct, slot: 1 }, newIp());
  const after = await call('/api/peek', { boxes: [mine, { id: n.id, access: 'wrong' }] }, newIp());
  const tooMany = await call('/api/peek', { boxes: Array.from({ length: 21 }, () => mine) }, newIp());
  const b0 = before.data?.boxes?.[0];
  const b1 = after.data?.boxes?.[0];
  report('S9', '새 소식 확인: 내 글만 있으면 0, 남이 남기면 시각이 생김, 틀린 열쇠는 빠짐, 21개는 400',
    before.status === 200 && b0?.entry === 0 && b0?.visit === 0 &&
      after.status === 200 && after.data.boxes.length === 1 && b1?.entry > 0 && tooMany.status === 400,
    `전 ${JSON.stringify(b0)} · 후 ${JSON.stringify(b1)} (${after.data?.boxes?.length}개) · 21개 ${tooMany.status}`);
}

// S10 해외 접속: 차단 국가(CN 등)·Tor는 API 403 region, 그 밖의 해외는 사람 확인 없이는 403 human(자기 확인 경로)·503 busy(나머지),
// 국내(KR)는 정상, GEO_OFF면 모두 정상. 로컬에서는 cf.country를 흉내 낼 수 없어 워커 코드를 직접 부른다(가짜 DB: 카운터 항상 1)
{
  const worker = (await import('../src/worker.js')).default;
  const ctx = { waitUntil() {} };
  const stmt = { first: async () => ({ n: 1, exp: Date.now() + 1e7 }), run: async () => ({}), all: async () => ({ results: [] }) };
  const env = { DB: { prepare: () => ({ bind: () => stmt }) }, TURNSTILE_SECRET: 'x', PEPPER: '00'.repeat(32) };
  const req = (country, path, body) => {
    const r = new Request(`https://findmeinkorea.com${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    Object.defineProperty(r, 'cf', { value: { country } });
    return r;
  };
  const find = { doors: ['a'.repeat(64)] };
  const peek = { boxes: [{ id: 'abcdefghij', access: 'a' }] };
  const cn = await worker.fetch(req('CN', '/api/find', find), env, ctx);
  const tor = await worker.fetch(req('T1', '/api/peek', peek), env, ctx);
  const usFind = await worker.fetch(req('US', '/api/find', find), env, ctx);
  const usPeek = await worker.fetch(req('US', '/api/peek', peek), env, ctx);
  const kr = await worker.fetch(req('KR', '/api/find', find), env, ctx);
  const off = await worker.fetch(req('CN', '/api/find', find), { ...env, GEO_OFF: '1' }, ctx);
  const body = async (r) => (await r.json())?.error || '';
  report('S10', '해외 접속: 차단 국가·Tor는 403 region, 다른 해외는 사람 확인 없이는 403 human / 503 busy, 국내는 정상, GEO_OFF면 정상',
    cn.status === 403 && tor.status === 403 && usFind.status === 403 && usPeek.status === 503 && kr.status === 200 && off.status === 200,
    `CN ${cn.status} ${await body(cn)} · T1 ${tor.status} ${await body(tor)} · US 찾기 ${usFind.status} ${await body(usFind)} · US peek ${usPeek.status} ${await body(usPeek)} · KR ${kr.status} · GEO_OFF ${off.status}`);
}

// S11 접속 신호(/hello)와 어드민 통계(/admin): 신호 2개(하나는 처음 방문, 하나는 모르는 유입 경로) → 오늘 접속 ≥2·처음 ≥1·경로 집계,
// 틀린 열쇠는 403, 한 IP에서 10번 틀리면 429. 열쇠는 .dev.vars의 ADMIN_KEY
{
  const adminKey = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim();
  const h1 = await call('/api/hello', { first: true, ref: 'kakao', route: 'home' }, newIp());
  const h2 = await call('/api/hello', { first: false, ref: 'weird-site', route: 'find' }, newIp());
  const dc = await call('/api/hello', { decoy: true }, newIp()); // 미끼 관리 페이지 시도
  const ok = await call('/api/admin', { key: adminKey }, newIp());
  const today = ok.data?.today;
  const n = (k) => (ok.data?.stats || []).filter((r) => r.day === today && r.k === k).reduce((s, r) => s + r.n, 0);
  const wrong = await call('/api/admin', { key: 'nope' }, newIp());
  const ip = newIp();
  let last;
  for (let i = 0; i < 11; i++) last = await call('/api/admin', { key: 'nope' }, ip);
  report('S11', '접속 신호는 날짜별 숫자로만 쌓이고, 어드민 통계는 열쇠가 맞을 때만. 틀린 열쇠 403, 10번 틀리면 429',
    h1.status === 200 && h2.status === 200 && dc.status === 200 && ok.status === 200 && n('uv') >= 2 && n('new') >= 1 &&
      n('r:kakao') >= 1 && n('r:other') >= 1 && n('e:find') >= 1 && n('decoy') >= 1 && Array.isArray(ok.data.months) &&
      typeof ok.data.devices === 'number' && wrong.status === 403 && last.status === 429,
    `신호 ${h1.status}/${h2.status} · 통계 ${ok.status} (오늘 접속 ${n('uv')}, 처음 ${n('new')}, 카카오 ${n('r:kakao')}, 그 밖 ${n('r:other')}, 찾기 화면 ${n('e:find')}, 미끼 ${n('decoy')}) · 틀린 열쇠 ${wrong.status} · 11번째 ${last.status}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length}개 중 문제 ${bad.length}개: ${bad.map((r) => r.id).join(', ') || '없음'}\n`);
