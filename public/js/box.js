import * as C from './crypto.js';
import { api, device, session, ApiError } from './api.js';
import {
  $, $$, esc, render, busy, toast, ago, when, STATUS, statusOf, hasCoord, BADGE, idFields, wireIdFields,
  kbdLink,
} from './ui.js';
import { setupBlock, wireSetup, recoverBlock, wireRecover } from './recovery.js';
import { mountView, fmtCoord, mapLinks } from './map.js';
import { readIdFields, makeDoors, placeBlock, wirePlace, readPlace, share, rudeCheck, noteShareText, roomShareText } from './write.js';

const WEEK = 7 * 86400_000;
const KEEP = 10; // 이전 장소는 최근 10곳까지만 보여 준다 (접속 기록은 서버가 10회만 남긴다)
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

// 남이 남긴 마지막 글·접속 시각. 서버의 /peek와 같은 기준이라 홈 화면 뱃지(app.js)가 둘을 비교한다
export function newsMark(data, mySlot) {
  const mine = Number.isInteger(mySlot) ? mySlot : -2;
  const entry = Math.max(0, ...data.entries.filter((e) => !((e.slot ?? -1) === mine && e.badge !== 'new')).map((e) => e.at));
  const visit = Math.max(0, ...(data.visits || []).filter((v) => v.slot !== mine).map((v) => v.at));
  return { entry, visit };
}

// 방 하나를 열어 해독한다
async function load(id) {
  const saved = device.get(id);
  const sess = session.get(id);
  const rB64 = saved?.r || sess?.r;
  if (!rB64) return { missing: true };
  const keys = await C.boxKeys(C.b64u.dec(rB64));
  let data;
  let offline = false;
  try {
    data = await api.read(id, { access: keys.access, token: saved?.token });
    // 저장본과 함께 "여기까지 봤다"는 표시(seen)를 남긴다. 홈 화면은 서버의 새 소식(peek)이 이보다 새로울 때만 뱃지를 단다
    if (saved) device.put(id, { cache: { ...data, at: Date.now() }, seen: newsMark(data, saved.slot) });
  } catch (e) {
    // 열쇠가 틀린 것(403)만 "열 수 없어요". 서버가 잠깐 오류를 내거나(5xx) 요청이 몰려 막혔으면(429) 저장본을 보여 준다
    if (e instanceof ApiError && e.status === 403) return { denied: true };
    if (!saved?.cache) return { unreachable: true, busy: e instanceof ApiError && e.body.error === 'busy' };
    data = saved.cache;
    offline = true;
  }
  const items = (
    await Promise.all(data.entries.map(async (e) => ({ ...e, body: await C.open(keys.content, e.ct) })))
  ).filter((x) => x.body);
  const trusted = data.type === 'note' ? 'owner' : 'admin';
  const header = items.filter((x) => x.body.k === 'header' && x.badge === trusted).at(-1)?.body;
  const posts = items.filter((x) => x.body.k === 'post');
  const seen = Object.fromEntries(data.seen.map((s) => [s.slot, s.at]));
  const visits = {};
  for (const v of data.visits || []) (visits[v.slot] ||= []).push(v.at);
  return { id, rB64, keys, saved, sess, data, header, posts, seen, visits, offline, type: data.type };
}

export async function showBox(id) {
  busy('여는 중…');
  let ctx;
  try {
    ctx = await load(id);
  } finally {
    busy();
  }
  if (ctx.missing || ctx.denied || ctx.unreachable || !ctx.header) {
    return render(`
      <section class="paper empty">
        <h1>${ctx.busy ? '지금 요청이 몰려요' : ctx.unreachable ? '연결할 수 없어요' : '열 수 없어요'}</h1>
        <p>${
          ctx.busy
            ? '잠시 뒤 다시 시도해 주세요.'
            : ctx.unreachable
              ? '인터넷이 되는 곳에서 다시 시도해 주세요.'
              : '이 기기에 열쇠가 없거나 바뀌었어요. 내 이름과 생일로 다시 찾아 주세요.'
        }</p>
        <a class="btn primary" href="#/find">다시 찾기</a>
      </section>`);
  }
  if (ctx.sess?.remember && !ctx.saved?.token) return whoAmI(ctx);
  return ctx.type === 'note' ? noteView(ctx) : roomView(ctx);
}

function people(ctx) {
  if (ctx.type === 'note') {
    return [
      { slot: 0, name: ctx.header.note.from, role: '보낸 사람' },
      { slot: 1, name: ctx.header.note.to, role: '받는 사람' },
    ];
  }
  return ctx.header.room.members.map((m, i) => ({ slot: i, name: m.name, role: i === 0 ? '처음 만든 사람' : '' }));
}

const myName = (ctx) => (Number.isInteger(ctx.saved?.slot) ? people(ctx)[ctx.saved.slot]?.name : null);
const boxTitle = (ctx) => (ctx.type === 'note' ? `${ctx.header.note.from} → ${ctx.header.note.to}` : ctx.header.room.title);
const isPowerful = (ctx) => ctx.saved?.role === 'admin' || ctx.saved?.role === 'owner';

// "이 기기 기억하기"를 고른 뒤, 이 기기가 누구 것인지 한 번 묻는다
function whoAmI(ctx) {
  render(`
    <section class="paper">
      <h1>이 기기는 누구의 것인가요?</h1>
      <p class="lede">고르면 다음부터 퀴즈 없이 열리고, 들어올 때마다 ${ctx.type === 'note' ? '상대' : '가족'}에게 마지막 접속이 표시돼요.</p>
      <div class="choices">
        ${people(ctx)
          .map(
            (p) => `<button class="btn big" data-slot="${p.slot}">${esc(p.name)}${
              p.role ? ` <span class="opt">${esc(p.role)}</span>` : ''
            }</button>`
          )
          .join('')}
      </div>
      <button class="btn ghost" id="skip">기억하지 않고 보기</button>
    </section>`);
  $$('[data-slot]').forEach((b) =>
    b.addEventListener('click', async () => {
      const slot = +b.dataset.slot;
      const token = C.newToken();
      busy('기억하는 중…');
      try {
        let taken = false;
        try {
          await api.device(ctx.id, { access: ctx.keys.access, tokenHash: await C.sha256hex(token), slot });
        } catch (e) {
          // 이 사람 자리는 이미 다른 기기가 기억했다. 이 기기에도 저장은 하되 ✅ 배지는 받지 못한다.
          if (!(e instanceof ApiError && e.body.error === 'taken')) throw e;
          taken = true;
        }
        device.put(ctx.id, { type: ctx.type, r: ctx.rB64, token, slot, role: 'device', taken, title: boxTitle(ctx) });
        session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: false });
        showBox(ctx.id);
        if (taken) {
          alert(
            '이 사람은 이미 다른 기기에서 기억돼 있어요.\n' +
              '이 기기에도 저장했지만, 여기서 남기는 글에는 "⚠️ 새 기기" 표시가 붙어요.\n\n' +
              '본인이 다른 기기에서 기억한 적이 없다면, 누군가 답을 알고 있다는 뜻이에요. 가족에게 알리세요.'
          );
        }
      } catch {
        toast('기억하지 못했어요. 다시 시도해 주세요.');
      } finally {
        busy();
      }
    })
  );
  $('#skip').addEventListener('click', () => {
    session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: false });
    showBox(ctx.id);
  });
}

// ---------- 이 기기 ----------

function identityBar(ctx) {
  if (ctx.offline) return '';
  if (!ctx.saved?.token) {
    return `
      <div class="idbar">
        <span>이 기기에 저장되지 않았어요. 탭을 닫으면 다시 찾아야 해요.</span>
        <button class="btn small" id="rememberNow">이 기기 기억하기</button>
      </div>`;
  }
  const me = people(ctx)[ctx.saved.slot];
  const role = ctx.saved.role === 'admin' ? '그룹장' : ctx.saved.role === 'owner' ? '보낸 사람' : me?.role || '구성원';
  return `
    <div class="idbar">
      <span>이 기기에 기억된 사람: <b>${esc(me?.name || '')}</b> · ${esc(role)}${
        ctx.saved.taken ? ' · <span class="badge warn">⚠️ 다른 기기가 먼저 기억함</span>' : ''
      }</span>
      <span class="idbar-actions">
        <button class="btn small ghost" id="notme">다른 사람이에요</button>
        <button class="btn small ghost" id="forget">이 기기에서 지우기</button>
      </span>
    </div>`;
}

function confirmForget(ctx) {
  const warn = isPowerful(ctx)
    ? `\n\n이 기기는 ${ctx.saved.role === 'admin' ? '그룹장' : '보낸 사람'} 기기예요. 지우면 복구 코드로만 권한을 되찾을 수 있어요.`
    : '';
  return confirm(`이 기기에서 「${boxTitle(ctx)}」를 지울까요?\n서버의 쪽지·기록은 그대로 남고, 이 기기에서만 사라져요.${warn}`);
}

function wireIdentity(ctx) {
  $('#rememberNow')?.addEventListener('click', () => {
    session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: true });
    showBox(ctx.id);
  });
  $('#notme')?.addEventListener('click', () => {
    if (!confirmForget(ctx)) return;
    device.remove(ctx.id);
    session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: true });
    showBox(ctx.id);
  });
  $('#forget')?.addEventListener('click', () => {
    if (!confirmForget(ctx)) return;
    device.remove(ctx.id);
    toast('이 기기에서 지웠어요.');
    location.hash = '#/';
  });
}

// ---------- 조각들 ----------

function offlineBanner(ctx) {
  return ctx.offline
    ? `<p class="banner">인터넷에 연결되지 않아, 이 기기에 저장된 내용을 보여 주고 있어요 (${esc(ago(ctx.data.at))} 저장).</p>`
    : '';
}

function placeCard(post, title) {
  const p = post.body.place;
  const coord = hasCoord(p);
  const links = coord ? mapLinks(p) : null;
  return `
    <section class="paper place-card">
      <h2>${title}</h2>
      ${
        coord
          ? `<div class="mapview" data-lat="${p.lat}" data-lng="${p.lng}" hidden></div>
             <button type="button" class="btn small" data-act="showmap">지도 보기 <span class="opt">약 100KB</span></button>`
          : ''
      }
      <p class="memo">${esc(p.memo)}</p>
      ${
        coord
          ? `<p class="coords">좌표 ${fmtCoord(p)} · <a href="${links.kakao}" target="_blank" rel="noopener">카카오맵</a>
             · <a href="${links.google}" target="_blank" rel="noopener">구글 지도</a></p>`
          : ''
      }
      <p class="fine">${esc(post.body.name)} · ${esc(when(post.at))} ${BADGE[post.badge] || ''}</p>
    </section>`;
}

// 이전 장소들: 최근 10곳까지
function placeHistory(posts, title) {
  const prev = posts.slice(0, -1).slice(-KEEP).reverse();
  if (!prev.length) return '';
  return `
    <details class="paper">
      <summary>${title} ${prev.length}곳 <span class="opt">최근 ${KEEP}곳까지</span></summary>
      <ol class="timeline">${prev
        .map((p) => {
          const pl = p.body.place;
          const coord = hasCoord(pl) ? ` · ${fmtCoord(pl)}` : '';
          return `<li class="entry">
            <div class="e-head"><b>${esc(p.body.name)}</b> ${BADGE[p.badge] || ''} <time>${esc(when(p.at))}</time></div>
            <p class="e-place">📍 ${esc(pl.memo)}${coord}</p>
          </li>`;
        })
        .join('')}</ol>
    </details>`;
}

function visitList(ctx, slot) {
  const list = ctx.visits[slot] || [];
  if (!list.length) return '';
  return `
    <details class="visits">
      <summary>접속 기록 ${list.length}회</summary>
      <ol>${list.map((at) => `<li>${esc(when(at))}</li>`).join('')}</ol>
    </details>`;
}

function entryItem(post, { officialAllowed, latest = false, mark = '' }) {
  const b = post.body;
  const st = statusOf(b.status);
  const official = b.official && officialAllowed;
  const p = b.place;
  const coord = hasCoord(p) ? ` · ${fmtCoord(p)}` : '';
  return `
    <li class="entry${official ? ' official' : ''}${latest ? ' latest' : ''}">
      <div class="e-head"><b>${esc(b.name)}</b> ${BADGE[post.badge] || ''} ${latest ? BADGE.latest : ''} ${mark}
        <time>${esc(when(post.at))}</time></div>
      ${official ? '<p class="e-flag">📌 집결지를 정했어요</p>' : ''}
      ${st ? `<span class="status ${st.cls}">${st.label}</span>` : ''}
      ${b.text ? `<p class="e-text">${nl2br(b.text)}</p>` : ''}
      ${p ? `<p class="e-place">📍 ${esc(p.memo)}${coord}</p>` : ''}
    </li>`;
}

// mark(post): 글마다 덧붙일 표시(쪽지의 "새 쪽지"·"확인함")
function timeline(ctx, posts, title = '기록', mark = () => '') {
  if (!posts.length) return '';
  const newestFirst = [...posts].reverse();
  // 쪽지는 새 답장을 위로 빼고 나머지만 여기 오므로, 정말 가장 최근 글일 때만 "제일 최근 기록"
  // (가족방은 집결지 글을 따로 보여 주고, 여기선 가족 기록 가운데 최근 것을 표시)
  const newest = ctx.type === 'note' ? ctx.posts.at(-1) : newestFirst[0];
  return `
    <section class="paper">
      <h2>${title}</h2>
      <ol class="timeline">${newestFirst
        .map((p) =>
          entryItem(p, { officialAllowed: ctx.type === 'room' && p.badge === 'admin', latest: p === newest, mark: mark(p) })
        )
        .join('')}</ol>
    </section>`;
}

function composeBlock(ctx, { title, defaultSlot }) {
  const me = myName(ctx);
  const opts = people(ctx);
  return `
    <section class="paper compose">
      <h2>${title}</h2>
      <form id="cf" novalidate>
        ${
          me
            ? `<p class="hint"><b>${esc(me)}</b>(으)로 남겨요.</p>`
            : `<label>누구로 남길까요?
                <select name="who">${opts
                  .map((p) => `<option value="${p.slot}" ${p.slot === defaultSlot ? 'selected' : ''}>${esc(p.name)}${p.role ? ` (${esc(p.role)})` : ''}</option>`)
                  .join('')}</select>
                <span class="hint">이 기기를 기억하지 않아서 ⚠️ 새 기기로 표시되고, 마지막 접속도 바뀌지 않아요.</span></label>`
        }
        <div class="chips">${Object.entries(STATUS)
          .map(([k, s]) => `<label class="chip ${s.cls}"><input type="radio" name="status" value="${k}"> ${s.label}</label>`)
          .join('')}</div>
        <label>남길 말 <textarea name="text" rows="3" maxlength="1000" placeholder="예: 1차 장소가 막혔어. 할머니 댁으로 가는 중."></textarea></label>
        ${kbdLink()}
        <label class="check"><input type="checkbox" name="withPlace"> 지금 있는 곳(또는 갈 곳) 남기기</label>
        <div id="cplace" hidden>${placeBlock('c', { label: '장소' })}</div>
        <button class="btn primary" type="submit">남기기</button>
      </form>
    </section>`;
}

async function wireCompose(ctx) {
  const f = $('#cf');
  if (!f) return;
  let placeState = null;
  f.withPlace.addEventListener('change', async () => {
    $('#cplace').hidden = !f.withPlace.checked;
    if (f.withPlace.checked && !placeState) placeState = await wirePlace(document, 'c');
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot = Number.isInteger(ctx.saved?.slot) ? ctx.saved.slot : +f.who.value;
    const name = people(ctx)[slot]?.name;
    const status = f.status.value || null;
    const text = f.text.value.trim();
    let place = null;
    if (f.withPlace.checked) {
      const r = readPlace(f, 'c', placeState || { point: null });
      if (r.error) return toast(r.error);
      place = r.place;
    }
    if (!status && !text && !place) return toast('상태, 말, 장소 중 하나는 남겨 주세요.');
    const rude = rudeCheck({ '남길 말': text, '장소 메모': place?.memo });
    if (rude) return toast(rude);
    await postBody(ctx, { k: 'post', name, status, text, place, official: false, ts: Date.now() }, slot);
  });
}

async function postBody(ctx, body, slot) {
  busy('남기는 중…');
  try {
    await api.post(ctx.id, {
      access: ctx.keys.access,
      ct: await C.seal(ctx.keys.content, body),
      token: ctx.saved?.token,
      slot,
    });
    toast('남겼어요.');
    showBox(ctx.id);
  } catch (e) {
    const code = e instanceof ApiError ? e.body.error : null;
    toast(
      code === 'box_busy'
        ? ctx.saved?.token
          ? '오늘 이 쪽지에 남긴 글이 너무 많아요. 내일 다시 시도해 주세요.'
          : '오늘은 새 기기에서 남긴 글이 너무 많아요. 기억된 기기로 남기거나 내일 다시 시도해 주세요.'
        : code === 'closed'
          ? '받는 사람이 이 쪽지를 지웠어요. 더 남길 수 없어요.'
          : code === 'busy'
            ? '지금 요청이 몰려요. 잠시 뒤 다시 시도해 주세요.'
            : '연결이 불안정해요. 다시 시도해 주세요.'
    );
    if (code === 'closed') showBox(ctx.id);
  } finally {
    busy();
  }
}

// 보낸 사람·그룹장: 다른 사람 자리의 기억된 기기를 풀어 준다 (남이 먼저 차지했거나 폰을 바꿨을 때)
function releaseBtn(ctx, slot, powerful) {
  if (!powerful || ctx.offline || slot === ctx.saved?.slot || !ctx.seen[slot]) return '';
  return `<button type="button" class="btn small ghost" data-release="${slot}">기기 기억 풀기</button>`;
}

function wireRelease(ctx) {
  $$('[data-release]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const slot = +btn.dataset.release;
      const name = people(ctx).find((p) => p.slot === slot)?.name || '';
      if (!confirm(`${name}님 자리에 기억된 기기를 풀까요?\n본인이 아닌 기기가 먼저 차지했거나, ${name}님이 폰을 바꿨을 때 쓰세요. 풀면 ${name}님이 새 기기로 다시 기억할 수 있어요.`)) return;
      busy('푸는 중…');
      try {
        const r = await api.release(ctx.id, { access: ctx.keys.access, token: ctx.saved.token, slot });
        toast(r.released ? '풀었어요.' : '풀 기기가 없어요. (그룹장 자리는 복구 질문으로만 바꿀 수 있어요)');
        showBox(ctx.id);
      } catch {
        toast('연결이 불안정해요. 다시 시도해 주세요.');
      } finally {
        busy();
      }
    })
  );
}

function mountMaps() {
  // 지도는 데이터를 많이 써서 눌렀을 때만 연다. 메모와 좌표만으로도 찾아갈 수 있다.
  $$('[data-act=showmap]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const el = btn.previousElementSibling;
      el.hidden = false;
      btn.remove();
      mountView(el, { lat: +el.dataset.lat, lng: +el.dataset.lng });
    })
  );
}

// ---------- 초대 코드(가족방 공동 그룹장) ----------

function inviteBlock(ctx) {
  const needWho = !Number.isInteger(ctx.saved?.slot);
  return `
    <details>
      <summary>그룹장 초대 코드가 있나요?</summary>
      <form id="codef" novalidate>
        <label>초대 코드 <input name="code" autocomplete="off" autocapitalize="characters" data-nokbd placeholder="예: ABCD-2345"></label>
        ${
          needWho
            ? `<label>나는 누구인가요?
                <select name="who">${people(ctx).map((p) => `<option value="${p.slot}">${esc(p.name)}</option>`).join('')}</select></label>`
            : ''
        }
        <button class="btn" type="submit">확인</button>
      </form>
    </details>`;
}

function wireInvite(ctx) {
  const f = $('#codef');
  f?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = C.cleanCode(f.code.value);
    if (code.length !== 8) return toast('초대 코드 8자를 확인해 주세요.');
    const slot = Number.isInteger(ctx.saved?.slot) ? ctx.saved.slot : +f.who.value;
    const token = C.newToken();
    busy('확인 중…');
    try {
      const res = await api.claim(ctx.id, { access: ctx.keys.access, code, slot, tokenHash: await C.sha256hex(token) });
      device.put(ctx.id, { type: ctx.type, r: ctx.rB64, token, slot: res.slot, role: res.role, title: boxTitle(ctx) });
      session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: false });
      toast('이제 이 기기가 그룹장이에요. 복구 질문도 만들어 두세요.');
      showBox(ctx.id);
    } catch (e) {
      const err = e instanceof ApiError ? e.body.error : null;
      toast(err === 'wrong' ? '코드가 맞지 않거나 이미 쓰였어요.' : err === 'too_many' ? '오늘은 더 시도할 수 없어요.' : '연결이 불안정해요.');
    } finally {
      busy();
    }
  });
}

// ---------- 복구 질문 ----------
// 보낸 사람·그룹장 기기: 질문 만들기·바꾸기. 다른 기기: 세 답을 맞혀 권한 되찾기.

async function recoveryTools(ctx, mine) {
  const el = $('#recSlot');
  if (!el || ctx.offline) return;
  if (mine) {
    const has = (ctx.data.recovery || []).some((r) => r.slot === ctx.saved.slot);
    el.innerHTML = setupBlock(ctx.type, { has });
    wireSetup({ id: ctx.id, access: ctx.keys.access, token: ctx.saved.token, content: ctx.keys.content });
    return;
  }
  const nameOf = (slot) => people(ctx).find((p) => p.slot === slot)?.name || '?';
  const { html, rows } = await recoverBlock(ctx, nameOf);
  el.innerHTML = html;
  if (rows.length) wireRecover(ctx, rows, { title: boxTitle(ctx), onDone: () => showBox(ctx.id) });
}

// ---------- 쪽지 ----------

// 쪽지의 글이 상대에게 닿았는지: 상대가 그 뒤에 글을 남겼거나, 상대의 기억된 기기가 그 뒤에 들어왔으면.
// 기기를 기억하지 않고 퀴즈로만 열어 본 건 서버가 알 수 없어서 표시하지 못한다.
// 내가 쓴 글을 상대가 읽었는지. 이 기기 주인이 쓴 글에만 표시한다
// (받는 사람 화면에서 보낸 사람의 쪽지에 붙으면, 내가 읽은 것이 "상대가 확인"처럼 보인다)
function readByOther(ctx, post) {
  if (!Number.isInteger(post.slot) || post.slot !== ctx.saved?.slot) return false;
  const other = post.slot === 0 ? 1 : 0;
  return ctx.posts.some((p) => p.slot === other && p.at > post.at) || (ctx.seen[other] || 0) > post.at;
}

// 이 기기 주인(보낸 사람·받는 사람)이 마지막으로 쓴 뒤에 상대가 남긴 답장 = 아직 답하지 않은 새 쪽지
function freshReplies(ctx, replies) {
  const mine = ctx.saved?.slot;
  if (!Number.isInteger(mine)) return [];
  const lastMine = Math.max(0, ...ctx.posts.filter((p) => p.slot === mine).map((p) => p.at));
  return replies.filter((p) => p.slot !== mine && p.at > lastMine);
}

const READ_MARK = '<span class="badge ok">✓ 상대가 확인했어요</span>';
const NEW_MARK = '<span class="badge new">새 쪽지</span>';

// 새 답장은 원래 쪽지 위에 편지처럼 펼쳐 보인다
function replyLetter(ctx, post) {
  const b = post.body;
  const st = statusOf(b.status);
  const toName = people(ctx).find((x) => x.slot !== post.slot)?.name || '';
  return `
    <section class="paper letter reply">
      <p class="kicker">${NEW_MARK} 답장</p>
      <h1>${esc(b.name)} → ${esc(toName)}</h1>
      ${st ? `<span class="status ${st.cls}">${st.label}</span>` : ''}
      ${b.text ? `<div class="letter-body">${nl2br(b.text)}</div>` : ''}
      ${b.place ? `<p class="e-place">📍 ${esc(b.place.memo)}${hasCoord(b.place) ? ` · ${fmtCoord(b.place)}` : ''}</p>` : ''}
      <p class="sig">— ${esc(b.name)}, ${esc(when(post.at))} ${BADGE[post.badge] || ''}</p>
    </section>`;
}

function noteView(ctx) {
  const { from, to } = ctx.header.note;
  const [first, ...rest] = ctx.posts;
  // 아직 답하지 않은 상대의 답장(최근 3개)은 원래 쪽지 위로, 나머지는 아래 "이어진 기록"에
  const fresh = freshReplies(ctx, rest);
  const onTop = fresh.slice(-3).reverse();
  const below = rest.filter((p) => !onTop.includes(p));
  // 약속 장소는 보낸 사람 기기(✅)로 올린 것만. 답을 아는 다른 사람이 장소를 바꿔 끼우지 못하게.
  // 다른 사람이 남긴 장소는 아래 기록에만 보인다.
  const placePosts = ctx.posts.filter((p) => p.body.place && p.badge === 'owner');
  const current = placePosts.at(-1);
  const isSender = ctx.saved?.slot === 0;
  const isOwner = ctx.saved?.role === 'owner' && ctx.data.role === 'owner';
  const closed = !!ctx.data.closed;
  render(`
    ${offlineBanner(ctx)}
    ${identityBar(ctx)}
    ${
      ctx.header.note.mutual && ctx.data.hidden
        ? `<p class="banner">🔒 아직 숨어 있어요. ${esc(to)}님이 ${esc(from)}님에게 쪽지를 쓰면 나타나요.</p>`
        : ''
    }
    ${
      closed
        ? `<p class="banner">${
            isSender
              ? '받는 사람이 이 쪽지를 지웠어요. 이제 누구도 찾을 수 없고, 이 기기에서만 보여요.'
              : '지운 쪽지예요. 누구도 다시 찾을 수 없어요.'
          }</p>`
        : ''
    }
    ${onTop.map((p) => replyLetter(ctx, p)).join('')}
    <section class="paper letter">
      <p class="kicker">${ctx.header.note.mutual ? '💌 맞쪽지' : '쪽지'}</p>
      <h1>${esc(from)} → ${esc(to)}</h1>
      ${first ? `<div class="letter-body">${nl2br(first.body.text || '')}</div>
      <p class="sig">— ${esc(first.body.name)}, ${esc(when(first.at))}</p>
      ${
        readByOther(ctx, first)
          ? `<p class="read-mark">${READ_MARK}</p>`
          : isSender
            ? '<p class="fine">아직 확인 표시가 없어요. 상대가 답장하거나 자기 기기를 기억하면 표시돼요.</p>'
            : ''
      }` : ''}
      ${isSender ? '' : `<p class="fine caution">보낸 사람 이름은 누구나 적을 수 있어요. 질문의 답을 남도 쉽게 알 수 있었다면 사칭을 의심하고, 답장으로 둘만 아는 걸 되물어 보세요.
        <b>돈·계좌·인증번호를 요구하면 사칭이에요.</b> 처음 만날 땐 대피소·주민센터처럼 사람이 많은 곳에서 만나세요.</p>`}
    </section>
    ${current ? placeCard(current, placePosts.length > 1 ? '지금 약속 장소 (바뀜)' : '약속 장소') : ''}
    ${placeHistory(placePosts, '이전 약속 장소')}
    <section class="paper">
      <h2>마지막 접속</h2>
      <ul class="people">${people(ctx)
        .map(
          (p) => `<li>
            <div class="row2 tight"><span><b>${esc(p.name)}</b> <span class="opt">${esc(p.role)}</span></span>
              <span>${esc(ago(ctx.seen[p.slot]))}</span></div>
            ${visitList(ctx, p.slot)}
            ${releaseBtn(ctx, p.slot, isOwner)}
          </li>`
        )
        .join('')}</ul>
      <p class="fine">접속 기록은 기억된 기기로 들어왔을 때만 남고, 최근 ${KEEP}회까지만 보관해요.</p>
    </section>
    ${timeline(ctx, below, '이어진 기록', (p) =>
      `${fresh.includes(p) ? NEW_MARK : ''} ${readByOther(ctx, p) ? '<span class="badge ok">✓ 확인</span>' : ''}`
    )}
    ${ctx.offline || closed ? '' : composeBlock(ctx, { title: isSender ? '장소가 바뀌었나요? 이어서 남기기' : '답장 남기기', defaultSlot: 1 })}
    ${
      ctx.offline
        ? ''
        : `<section class="paper tools">
            ${isSender && !ctx.header.note.mutual && !closed ? `<p class="fine">상대에게 미리 알리고 싶다면 보내세요. 쪽지 내용과 답은 들어가지 않아요.</p>
              <button class="btn" id="share">상대에게 알리기</button>` : ''}
            <div id="recSlot"></div>
          </section>`
    }
    ${
      ctx.offline || closed || isSender
        ? ''
        : `<section class="paper">
            <h2>스팸이나 욕설인가요?</h2>
            <p class="fine">지우면 누구도 이 쪽지를 다시 찾을 수 없어요. 보낸 사람 기기에는 "받는 사람이 지웠어요"로 남아요. 되돌릴 수 없어요.</p>
            <button class="btn" id="closeNote">이 쪽지 지우기</button>
          </section>`
    }
    <p class="center"><a class="btn ghost" href="#/">처음으로</a></p>
  `);
  mountMaps();
  wireIdentity(ctx);
  wireCompose(ctx);
  wireClose(ctx);
  $('#share')?.addEventListener('click', () => share(noteShareText()));
  wireRelease(ctx);
  recoveryTools(ctx, isOwner);
}

function wireClose(ctx) {
  $('#closeNote')?.addEventListener('click', async () => {
    if (!confirm('이 쪽지를 지울까요?\n누구도 다시 찾을 수 없고, 되돌릴 수 없어요.')) return;
    busy('지우는 중…');
    try {
      await api.close(ctx.id, { access: ctx.keys.access, token: ctx.saved?.token });
      device.remove(ctx.id);
      try {
        sessionStorage.removeItem('findme.results');
      } catch {}
      toast('쪽지를 지웠어요.');
      location.hash = '#/';
    } catch {
      toast('지우지 못했어요. 인터넷이 되는 곳에서 다시 시도해 주세요.');
    } finally {
      busy();
    }
  });
}

// ---------- 가족방 ----------

function roomView(ctx) {
  const { title, members } = ctx.header.room;
  const isAdmin = ctx.saved?.role === 'admin' && ctx.data.role === 'admin';
  const official = ctx.posts.filter((p) => p.body.official && p.badge === 'admin');
  const current = official.at(-1);
  const latestBy = (slot, name) =>
    [...ctx.posts]
      .reverse()
      .find((p) => (p.slot === slot || p.body.name === name) && !p.body.official && (p.body.status || p.body.place));
  const recentFails = ctx.data.fails?.n > 0 && Date.now() - ctx.data.fails.at < WEEK ? ctx.data.fails.n : 0;

  render(`
    ${offlineBanner(ctx)}
    ${identityBar(ctx)}
    <section class="paper">
      <p class="kicker">가족방 · ${members.length}명</p>
      <h1>${esc(title)}</h1>
      ${isAdmin ? '<p>' + BADGE.admin + ' 이 기기는 그룹장이에요.</p>' : ''}
      ${
        isAdmin && ctx.data.admins < 2
          ? `<p class="warn-line">⚠️ 그룹장이 1명뿐이에요. 나에게 무슨 일이 생기면 집결지를 바꿀 수 없어요. 아래에서 함께 관리할 사람을 지정해 두세요.</p>`
          : ''
      }
      ${recentFails ? `<p class="warn-line">최근 7일 동안 질문의 답을 틀린 시도가 ${recentFails}번 있었어요. 모르는 사람이 시도했을 수 있어요.</p>` : ''}
    </section>
    ${current ? placeCard(current, '지금 집결지') : ''}
    ${placeHistory(official, '이전 집결지')}
    <section class="paper">
      <h2>가족</h2>
      <ul class="members">${members
        .map((m, i) => {
          const last = latestBy(i, m.name);
          const st = last && statusOf(last.body.status);
          return `<li>
            <div><b>${esc(m.name)}</b>${ctx.saved?.slot === i ? ' <span class="opt">나</span>' : ''}</div>
            <div class="m-seen">마지막 접속 ${esc(ago(ctx.seen[i]))}</div>
            ${st ? `<span class="status ${st.cls}">${st.label}</span>` : ''}
            ${last?.body.place ? `<div class="m-place">📍 ${esc(last.body.place.memo)}</div>` : ''}
            ${last ? `<div class="m-seen">${esc(ago(last.at))} 남김 ${last.badge === 'new' ? BADGE.new : ''}</div>` : ''}
            ${visitList(ctx, i)}
            ${releaseBtn(ctx, i, isAdmin)}
          </li>`;
        })
        .join('')}</ul>
      <p class="fine">접속 기록은 기억된 기기로 들어왔을 때만 남고, 최근 ${KEEP}회까지만 보관해요.</p>
    </section>
    ${ctx.offline ? '' : composeBlock(ctx, { title: '내 상태 남기기', defaultSlot: 1 })}
    ${timeline(ctx, ctx.posts.filter((p) => !(p.body.official && p.badge === 'admin')), '가족 기록')}
    ${ctx.offline ? '' : isAdmin ? adminTools(ctx) : `<section class="paper tools">${inviteBlock(ctx)}<div id="recSlot"></div></section>`}
    ${ctx.offline ? '' : `<section class="paper tools">
        <p class="fine">이 가족방을 아직 모르는 가족이 있다면 보내 주세요. 답은 들어가지 않아요.</p>
        <button class="btn" id="share">가족에게 알리기</button>
      </section>`}
    <p class="center"><a class="btn ghost" href="#/">처음으로</a></p>
  `);
  mountMaps();
  wireIdentity(ctx);
  wireCompose(ctx);
  if (ctx.offline) return;
  $('#share').addEventListener('click', () => share(roomShareText(ctx.header.room.title)));
  wireRelease(ctx);
  if (isAdmin) wireAdmin(ctx);
  else wireInvite(ctx);
  recoveryTools(ctx, isAdmin);
}

function adminTools(ctx) {
  return `
    <section class="paper admin">
      <h2>그룹장 도구</h2>
      <details>
        <summary>집결지 바꾸기</summary>
        <form id="of" novalidate>
          ${placeBlock('o', { label: '새 집결지' })}
          <label>한마디 <span class="opt">선택</span> <input name="text" maxlength="300" placeholder="예: 1차 장소가 위험해서 바꿨어. 여기로 와."></label>
          <button class="btn primary" type="submit">새 집결지 알리기</button>
        </form>
      </details>
      <details>
        <summary>함께 관리할 사람 지정</summary>
        <p class="hint">초대 코드를 만들어 가족에게 직접(전화·카톡) 알려 주세요. 그 사람이 자기 기기에서 이 가족방을 열고 코드를 넣으면 그룹장이 돼요. 코드는 한 번만 쓸 수 있어요.</p>
        <button class="btn" id="inv">초대 코드 만들기</button>
        <p class="code" id="code" hidden></p>
      </details>
      <details>
        <summary>구성원 추가</summary>
        <form id="mf" novalidate>
          <label>이름 <input name="nname" maxlength="40" placeholder="예: 김민지"></label>
          ${idFields('n')}
          <button class="btn" type="submit">추가하기</button>
        </form>
      </details>
      <div id="recSlot"></div>
    </section>`;
}

function wireAdmin(ctx) {
  const of = $('#of');
  let oState = null;
  of.closest('details').addEventListener('toggle', async (e) => {
    if (e.target.open && !oState) oState = await wirePlace(document, 'o');
  });
  of.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = readPlace(of, 'o', oState || { point: null });
    if (r.error) return toast(r.error);
    const rude = rudeCheck({ '남길 말': of.text.value, '장소 메모': r.place.memo });
    if (rude) return toast(rude);
    await postBody(
      ctx,
      { k: 'post', name: myName(ctx), official: true, place: r.place, text: of.text.value.trim(), ts: Date.now() },
      ctx.saved.slot
    );
  });

  $('#inv').addEventListener('click', async () => {
    const code = C.newInviteCode();
    busy('코드를 만드는 중…');
    try {
      await api.invite(ctx.id, { access: ctx.keys.access, token: ctx.saved.token, inviteHash: await C.sha256hex(code) });
      const el = $('#code');
      el.textContent = C.fmtCode(code);
      el.hidden = false;
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429 ? '아직 쓰지 않은 코드가 많아요.' : '코드를 만들지 못했어요.');
    } finally {
      busy();
    }
  });

  const mf = $('#mf');
  wireIdFields(mf);
  mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = mf.nname.value.trim();
    if (!name) return toast('이름을 적어 주세요.');
    const rude = rudeCheck({ '이름': name });
    if (rude) return toast(rude);
    const ids = readIdFields(mf, 'n');
    if (ids.error) return toast(ids.error);
    if (!ids.ymd && !ids.year && !ids.md && !ids.phone) return toast('생일, 나이, 전화번호 중 하나는 필요해요.');
    const room = ctx.header.room;
    const members = [...room.members, { name }];
    busy('추가하는 중…');
    try {
      const teaser = { t: 'room', q: room.q, title: room.title, n: members.length, at: new Date().toISOString().slice(0, 7) };
      const doors = await makeDoors(C.writerIdentities({ name, ...ids }, null), teaser);
      await api.doors(ctx.id, { access: ctx.keys.access, token: ctx.saved.token, doors });
      await api.post(ctx.id, {
        access: ctx.keys.access,
        token: ctx.saved.token,
        ct: await C.seal(ctx.keys.content, { k: 'header', room: { ...room, members }, ts: Date.now() }),
      });
      toast(`${name}님을 추가했어요.`);
      showBox(ctx.id);
    } catch {
      toast('추가하지 못했어요. 다시 시도해 주세요.');
    } finally {
      busy();
    }
  });
}
