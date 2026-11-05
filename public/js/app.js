import * as C from './crypto.js';
import { api, device, session, ApiError } from './api.js';
import { $, $$, esc, render, busy, toast } from './ui.js';
// 쓰기·쪽지 보기·사람 확인 코드는 그 화면을 열 때 받는다. 첫 화면을 가볍게 하려고.
// 서비스 워커가 첫 화면이 뜬 뒤 뒤에서 모두 받아 두므로, 그다음부터는 인터넷이 끊겨도 열린다.
async function load(file) {
  const slow = setTimeout(() => busy('화면을 불러오는 중…'), 300);
  try {
    return await import(file);
  } catch (e) {
    // 받다가 끊겼거나, 새 버전이 배포돼 이미 받은 코드와 맞지 않을 때.
    // 브라우저는 한 번 실패한 화면 코드를 다시 받지 않으므로 페이지를 새로 불러야 한다.
    console.error(e);
    render(`
      <section class="paper empty">
        <h1>화면을 불러오지 못했어요</h1>
        <p>인터넷 연결이 불안정해요. 연결되면 다시 시도해 주세요.</p>
        <div class="row2">
          <button class="btn primary" id="retry">다시 시도</button>
          <a class="btn ghost" href="#/">처음으로</a>
        </div>
      </section>`);
    $('#retry').addEventListener('click', () => location.reload());
    return null;
  } finally {
    clearTimeout(slow);
    busy();
  }
}
// 사람 확인은 기다림 화면(busy) 위에 뜨므로 load()처럼 기다림 화면을 건드리지 않는다
const humanToken = async (action) => (await import('./human.js')).humanToken(action);

const RESULTS_KEY = 'findme.results';
const PREFILL_KEY = 'findme.prefill'; // write.js의 쪽지 다 쓴 화면이 채운다
const PER_DOOR = 8; // 서버의 LIMITS.findPerDoor
const GROUP_AT = 6; // 이름·생일로만 맞는 쪽지가 이만큼 넘으면 접어 둔다
const questions = (q) => (Array.isArray(q) ? q : q == null ? [] : [q]);

// ---------- 홈 ----------

// 새 소식 뱃지: 서버가 알려 준 남의 마지막 글·접속(news)이, 이 기기에서 마지막으로 본 시점(seen)보다 새로우면 단다
function newsBadge(b) {
  const n = b?.news;
  if (!n) return '';
  const s = b.seen || {};
  const entry = (n.entry || 0) > (s.entry || 0);
  const visit = (n.visit || 0) > (s.visit || 0);
  if (!entry && !visit) return '';
  return `<span class="badge new">${entry && visit ? '새 글·접속' : entry ? '새 글' : '새 접속'}</span>`;
}

// 저장된 쪽지·가족방의 새 소식을 한 번에 묻는다. 뒤에서 조용히, 30초에 한 번만. 실패하면 그냥 둔다
let peekedAt = 0;
async function peekNews(saved) {
  if (Date.now() - peekedAt < 30_000) return;
  peekedAt = Date.now();
  const boxes = await Promise.all(
    saved.slice(0, 20).map(async (b) => ({ id: b.id, access: (await C.boxKeys(C.b64u.dec(b.r))).access, token: b.token }))
  );
  try {
    const res = await api.peek(boxes);
    for (const x of res.boxes || []) {
      device.mark(x.id, { news: { entry: x.entry, visit: x.visit } });
      const el = $(`[data-news="${CSS.escape(x.id)}"]`);
      if (el) el.innerHTML = newsBadge(device.get(x.id));
    }
  } catch {}
}

// ---------- 후원 ----------
// 카카오페이 송금코드(https://qr.kakaopay.com/…)와 토스아이디(https://toss.me/아이디) 링크. 둘 다 비어 있으면 후원 묶음을 보여 주지 않는다.
// qr은 링크를 QR로 만든 정적 그림(node scripts/qr.mjs '링크' public/qr-kakaopay.svg). 링크를 바꾸면 QR도 다시 만든다.
// 그냥 링크와 그림이라 새 스크립트·CSP 변경이 없다. 쓰임새 문구는 일부러 적지 않는다.
const SUPPORT = {
  kakao: 'https://qr.kakaopay.com/Ej9NDsbHF',
  qr: '/qr-kakaopay.svg',
  toss: '',
};

// 엽서 위에 붙인 우표(QR). 오작교 전설(까치들이 한 마리씩 모여 놓은 다리)에 빗대어, 대놓고 바라는 말은 쓰지 않는다
function supportBlock() {
  if (!SUPPORT.toss && !SUPPORT.kakao) return '';
  const link = (href, label) => (href ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : '');
  const stamp =
    SUPPORT.kakao && SUPPORT.qr
      ? `<a class="pc-stamp" href="${esc(SUPPORT.kakao)}" target="_blank" rel="noopener" aria-label="카카오페이 송금 QR 코드">
          <img src="${esc(SUPPORT.qr)}" alt="" width="96" height="96" loading="lazy"><span>카카오페이</span></a>`
      : '';
  return `
    <section class="support">
      <div class="postcard">
        <div class="pc-text">
          <p class="kicker">까치 한 마리 보태기</p>
          <h2>오작교는 까치들이 한 마리씩 모여 놓은 다리예요</h2>
          <p>마음이 닿았다면 까치 한 마리를 보태 주세요. 금액은 자유예요.</p>
        </div>
        ${stamp}
        <div class="pc-actions">${link(SUPPORT.kakao, '카카오페이로 보태기')}${link(SUPPORT.toss, '토스로 보태기')}</div>
      </div>
      ${stamp ? '<p class="fine">우표의 QR은 다른 폰 카메라로 찍어도 바로 열려요.</p>' : ''}
    </section>`;
}

// ---------- 사이트 주소 복사 ----------

const SITE_URL = 'https://findmeinkorea.com';

// 클립보드 API가 없는 브라우저용 예비 방법
function copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  ta.remove();
  return ok;
}

async function copySite() {
  let ok = false;
  try {
    await navigator.clipboard.writeText(SITE_URL);
    ok = true;
  } catch {}
  if (!ok) ok = copyFallback(SITE_URL);
  sharePop(ok);
}

// "find me in korea"가 붙으며 findmeinkorea.com이 되는 팝업. 외우기 쉽게
let popTimer;
function sharePop(ok) {
  $('#share-pop')?.remove();
  const el = document.createElement('div');
  el.id = 'share-pop';
  el.className = 'pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="pop-box">
      <p class="brand" role="img" aria-label="findmeinkorea.com"><span>find</span><i></i><span>me</span><i></i><span>in</span><i></i><span>korea</span><em>.com</em></p>
      <p class="pop-msg">${ok ? '클립보드에 복사되었습니다!' : '복사할 수 없어요. 아래 주소를 길게 눌러 복사해 주세요.'}</p>
      ${ok ? '' : `<p class="pop-url">${SITE_URL}</p>`}
      <button type="button" class="btn small">닫기</button>
    </div>`;
  const close = () => {
    clearTimeout(popTimer);
    el.remove();
  };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('button')) close();
  });
  document.body.appendChild(el);
  $('button', el).focus();
  clearTimeout(popTimer);
  if (ok) popTimer = setTimeout(close, 4500);
}

async function home() {
  const saved = device.list();
  render(`
    <section class="hero">
      <p class="kicker">1950년, 피난민들은 다리 난간과 벽에 쪽지를 붙였습니다.</p>
      <h1>전쟁이 나면 전화와 국내 메신저는 끊깁니다.<br>하지만 쪽지는 남습니다.</h1>
      <p class="lede">소중한 사람에게 쪽지와 약속 장소를 남겨 두세요.<br>
        상대는 언제 어디서든 인터넷만 된다면 <b>자기 이름과 생일</b>로 찾아와 확인할 수 있습니다.<br>
        국내 메신저망이 먹통이 되더라도, 핸드폰을 잃어버리더라도 오작교의 쪽지는 서로를 연결합니다.</p>
      <p class="counter" id="counter">&nbsp;</p>
    </section>
    <nav class="actions">
      <a class="btn primary big" href="#/find">나에게 남겨진 쪽지 확인</a>
      <div class="row2">
        <a class="btn" href="#/write">쪽지 남기기</a>
        <a class="btn" href="#/room/new">가족방 만들기</a>
      </div>
    </nav>
    ${
      saved.length
        ? `<section class="saved">
            <h2>이 기기에 저장된 쪽지·가족방</h2>
            ${saved
              .map(
                (b) => `<div class="card">
                  <a class="card-main" href="#/box/${esc(b.id)}">
                    <span class="card-kind">${b.type === 'room' ? '가족방' : '쪽지'}</span>
                    <span class="card-title">${esc(b.title || '')}</span>
                    <span class="card-news" data-news="${esc(b.id)}">${newsBadge(b)}</span>
                  </a>
                  <button class="btn small ghost" data-del="${esc(b.id)}">지우기</button>
                </div>`
              )
              .join('')}
            <p class="fine">빌린 폰이라면 다 보고 나서 지워 주세요. 서버의 쪽지·기록은 그대로 남아요.</p>
            <button class="btn small" id="clearAll">이 기기에서 모두 지우기</button>
          </section>`
        : ''
    }
    <section class="how">
      <h2>사용 방법</h2>
      <ol>
        <li><b>쪽지 남기기</b> — 받는 사람의 이름과 아는 정보(생일, 나이, 전화번호)를 적고, 둘만 아는 질문을 정합니다. 남겨진 쪽지는 영구히 남습니다.</li>
        <li><b>상대가 찾기</b> — 상대는 자기 이름과 생일만 넣으면 자기 앞으로 온 쪽지를 봅니다. 미리 알려 줘도 되고, 몰래 남겨 둬도 됩니다.</li>
        <li><b>퀴즈를 풀면</b> — 메시지, 약속 장소, 보낸 사람의 마지막 접속이 보입니다. 장소가 바뀌면 계속 이어서 남길 수 있습니다.</li>
      </ol>
      <p class="fine">가족은 <a href="#/room/new">가족방</a>을 만들어 집결지와 서로의 상태를 한곳에서 확인하세요.</p>
    </section>
    <section class="share">
      <h2>미리 알려 두세요</h2>
      <p>주소는 <b>find me in korea</b>, 네 단어를 붙여 쓰면 됩니다. 평소에 가족과 소중한 사람에게 보내 두세요.</p>
      <button type="button" class="btn" id="copySite">사이트 주소 복사하기</button>
    </section>
    ${supportBlock()}
  `);
  $('#copySite').addEventListener('click', copySite);
  if (saved.length) peekNews(saved);
  document.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const item = device.get(b.dataset.del);
      const strong = item?.role === 'admin' || item?.role === 'owner';
      const msg = `이 기기에서 「${item?.title || ''}」를 지울까요?` +
        (strong ? `\n\n이 기기는 ${item.role === 'admin' ? '그룹장' : '보낸 사람'} 기기예요. 지우면 복구 질문 3개의 답으로만 권한을 되찾을 수 있어요.` : '');
      if (!confirm(msg)) return;
      device.remove(b.dataset.del);
      home();
    })
  );
  $('#clearAll')?.addEventListener('click', () => {
    const strong = device.list().some((b) => b.role === 'admin' || b.role === 'owner');
    const msg = '이 기기에 저장된 쪽지·가족방과 찾은 결과를 모두 지울까요?' +
      (strong ? '\n\n그룹장이나 보낸 사람 기기가 포함돼 있어요. 지우면 복구 질문 3개의 답으로만 권한을 되찾을 수 있어요.' : '');
    if (!confirm(msg)) return;
    device.clearAll();
    toast('이 기기에서 모두 지웠어요.');
    home();
  });
  try {
    const s = await api.stats();
    $('#counter').innerHTML = `오늘 <b>${s.today.toLocaleString()}</b>장의 쪽지가 남겨졌습니다`;
  } catch {
    $('#counter').textContent = '';
  }
}

// ---------- 찾기 ----------

function findForm() {
  render(`
    <section class="paper">
      <h1>나에게 남겨진 쪽지 확인</h1>
      <p class="lede">내 이름과 생일로, 누군가 나에게 남긴 쪽지와 가족방을 찾습니다.</p>
      <form id="f" novalidate>
        <label>내 이름 <input name="name" autocomplete="name" maxlength="40" required placeholder="예: 김민준"></label>
        <label>내 생일 <input name="bd" inputmode="numeric" required placeholder="예: 19950314"></label>
        <details>
          <summary>더 찾아보기 <span class="opt">선택</span></summary>
          <label>내 전화번호 <input name="phone" inputmode="tel" placeholder="예: 010-1234-5678"></label>
          <label>혹시 남겼을 것 같은 사람 이름
            <input name="from" maxlength="40" placeholder="예: 이서연">
            <span class="hint">상대가 내 생일을 몰랐거나 맞쪽지를 보냈다면, 이 이름으로 찾아야 보여요.</span>
          </label>
        </details>
        <p class="error" id="err" hidden></p>
        <button class="btn primary big" type="submit">찾기</button>
      </form>
    </section>
  `);
  // 쪽지를 쓰고 나서 "상대도 나에게 남겼는지" 찾으러 온 경우: 내 이름·생일과 상대 이름을 채워 둔다
  let pre = null;
  try {
    pre = JSON.parse(sessionStorage.getItem(PREFILL_KEY));
    sessionStorage.removeItem(PREFILL_KEY);
  } catch {}
  if (pre) {
    const f = $('#f');
    f.name.value = pre.name || '';
    f.bd.value = pre.bd || '';
    f.from.value = pre.from || '';
    $('details', f).open = true;
    (pre.bd ? f.querySelector('button') : f.bd).focus();
  }
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#err');
    const name = f.name.value.trim();
    const ymd = C.normDate(f.bd.value);
    const phone = f.phone.value.trim() ? C.normPhone(f.phone.value) : null;
    const fromName = f.from.value.trim();
    const problem = !name
      ? '이름을 적어 주세요.'
      : !ymd
        ? '생일을 8자리 숫자로 적어 주세요. 예: 19950314'
        : f.phone.value.trim() && !phone
          ? '전화번호 형식을 확인해 주세요.'
          : null;
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    busy('쪽지를 찾는 중…');
    try {
      // 남이 알기 어려운 문(전화번호·보낸 사람 이름)을 먼저 보낸다. 서버는 앞에 있는 문의 쪽지부터 담는다.
      // 이름·생일은 유명인처럼 널리 알려져 있을 수 있다.
      const first = ['phone', 'pair', 'full', 'sent'];
      const pos = (l) => (first.includes(l) ? first.indexOf(l) : first.length);
      const ids = C.searcherIdentities({ name, ymd, phone, fromName }).sort(([a], [b]) => pos(a) - pos(b));
      const doors = await Promise.all(ids.map(async ([level, s]) => ({ level, ...(await C.door(s)) })));
      let res;
      try {
        res = await api.find(doors.map((d) => d.id));
      } catch (e) {
        // 같은 와이파이(대피소 등)에서 찾기가 많으면 사람인지 확인한 뒤 계속 찾는다
        if (!(e instanceof ApiError && e.body.error === 'human')) throw e;
        busy('찾는 중… 같은 와이파이에서 찾는 사람이 많아 사람인지 확인해요');
        res = await api.find(doors.map((d) => d.id), await humanToken('find'));
      }
      const { results } = res;
      const byId = Object.fromEntries(doors.map((d) => [d.id, d]));
      const order = Object.keys(C.LEVEL);
      const seen = new Map();
      // 서버는 문마다 최근 쪽지 몇 개만 준다. 그만큼 왔으면 더 있을 수 있다
      const perDoor = {};
      for (const r of results) perDoor[r.door] = (perDoor[r.door] || 0) + 1;
      const capped = Object.values(perDoor).some((n) => n >= PER_DOOR);
      for (const r of results) {
        const d = byId[r.door];
        const teaser = d && (await C.open(d.key, r.teaser));
        if (!teaser) continue;
        const prev = seen.get(r.box);
        const levels = [...new Set([...(prev?.levels || []), d.level])];
        const best = prev && order.indexOf(prev.level) <= order.indexOf(d.level) ? prev.level : d.level;
        seen.set(r.box, { box: r.box, type: r.type, salt: r.salt, teaser, level: best, levels, at: r.created_at, last: r.last_at, hidden: !!r.hidden });
      }
      // 생일과 전화번호가 둘 다 맞는 것 → 하나라도 맞는 것 → 나머지. 같은 정도면 가족방 먼저, 그다음
      // 더 정확히 일치한 것, 최근에 기록된 것부터. 이름만 맞춘 쪽지를 많이 뿌려도 진짜 쪽지가 아래로 밀리지 않게.
      const exact = (r) => (r.levels.includes('full') ? 1 : 0) + (r.levels.includes('phone') ? 1 : 0);
      const list = [...seen.values()].sort(
        (a, b) =>
          exact(b) - exact(a) ||
          (a.type === 'room' ? -1 : 0) - (b.type === 'room' ? -1 : 0) ||
          order.indexOf(a.level) - order.indexOf(b.level) ||
          (b.last || b.at || 0) - (a.last || a.at || 0)
      );
      sessionStorage.setItem(RESULTS_KEY, JSON.stringify({ name, list, capped }));
      location.hash = '#/results';
    } catch (e) {
      err.textContent =
        e instanceof ApiError && e.status === 429
          ? '잠시 너무 많이 찾았어요. 조금 뒤에 다시 시도해 주세요.'
          : e?.message === 'human' || e?.message === 'human_load'
            ? '사람인지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
            : '연결이 불안정해요. 인터넷이 되는 곳에서 다시 시도해 주세요.';
      err.hidden = false;
    } finally {
      busy();
    }
  });
}

function noteKind(r) {
  if (r.level === 'sent') {
    if (!r.teaser.m) return '내가 보낸 쪽지';
    return r.hidden ? '내가 보낸 맞쪽지 · 🔒 아직 숨어 있어요' : '내가 보낸 맞쪽지 · 💌 열렸어요';
  }
  return r.teaser.m ? '💌 맞쪽지 · 서로 썼어요' : '쪽지';
}

function matchLabel(r) {
  return r.levels?.includes('full') && r.levels.includes('phone') ? '생일·전화번호 일치' : C.LEVEL[r.level];
}

// 날짜는 서버가 기록한 것만 믿는다. 쪽지 안에 적힌 날짜는 누구나 꾸밀 수 있다.
function madeLabel(r) {
  if (!r.at) return '';
  const day = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  const made = `${day(r.at)} 남김`;
  return r.last && day(r.last) !== day(r.at) ? `${made} · 마지막 기록 ${day(r.last)}` : made;
}

function loadResults() {
  try {
    return JSON.parse(sessionStorage.getItem(RESULTS_KEY));
  } catch {
    return null;
  }
}

function noteCard(r, i, hidden) {
  // 내가 보낸 맞쪽지는 "내가 보낸 쪽지" 문에 질문을 담지 않는다(내 이름·생일을 아는 남이 보지 못하게). 상태만 보인다
  const tag = r.teaser.q == null ? 'div' : 'a';
  return `
    <div class="nc-wrap">
      <${tag} class="note-card ${r.type}" ${tag === 'a' ? `href="#/unlock/${esc(r.box)}"` : ''} style="--tilt:${((i % 3) - 1) * 0.6}deg">
        <span class="tape"></span>
        <span class="nc-kind">${
          r.type === 'room' ? `가족방 「${esc(r.teaser.title)}」 · ${esc(r.teaser.n)}명` : noteKind(r)
        }</span>
        <span class="nc-meta">${r.level === 'sent' ? '' : `${esc(matchLabel(r))} · `}${esc(madeLabel(r))}</span>
        ${
          tag === 'a'
            ? questions(r.teaser.q).map((q) => `<span class="nc-q">Q. ${esc(q)}</span>`).join('')
            : '<span class="nc-meta">질문은 받는 사람에게만 보여요</span>'
        }
      </${tag}>
      <button type="button" class="nc-hide" data-hide="${esc(r.box)}" data-on="${hidden ? 0 : 1}">${
        hidden ? '다시 보이기' : '숨기기'
      }</button>
    </div>`;
}

function results() {
  const data = loadResults();
  if (!data) return (location.hash = '#/find');
  const { name, list, capped } = data;
  // 스팸·욕설 쪽지는 이 기기에서 숨긴다. 서버에서 지우지 않는 건, 같은 이름·출생연도를 쓰는 다른 사람이나
  // 내 생일을 아는 남이 나에게 온 진짜 쪽지를 지울 수 있게 되기 때문이다.
  const hiddenIds = device.hidden();
  const shown = list.filter((r) => !hiddenIds.has(r.box));
  const hidden = list.filter((r) => hiddenIds.has(r.box));
  // 이름·생일은 남도 알 수 있다(유명인이면 팬 쪽지가 몰린다). 남이 알기 어려운 것까지 맞은 쪽지를 위에 두고,
  // 이름·생일로만 맞은 쪽지가 많으면 접어 둔다.
  const sure = (r) => ['phone', 'pair', 'sent'].some((l) => r.levels?.includes(l)) || (r.teaser.m && r.level !== 'sent');
  const group = shown.filter((r) => !sure(r)).length >= GROUP_AT;
  const top = group ? shown.filter(sure) : shown;
  const rest = group ? shown.filter((r) => !sure(r)) : [];
  render(`
    <section>
      <h1>${esc(name)}님 앞으로 남겨진 것</h1>
      ${
        shown.length
          ? `<p class="lede">질문을 보고 나에게 온 것인지 확인하세요. 남의 쪽지는 답을 몰라 열 수 없어요.</p>
             ${top.length ? `<div class="notes">${top.map((r, i) => noteCard(r, i, false)).join('')}</div>` : ''}
             ${
               rest.length
                 ? `<details class="many-notes"${top.length ? '' : ' open'}>
                      <summary>이름·생일로만 맞는 쪽지 ${rest.length}개${capped ? '+' : ''}</summary>
                      <p class="hint">이름과 생일은 남도 알 수 있어서 모르는 사람의 쪽지가 섞여 있을 수 있어요.
                        ${capped ? '너무 많아 최근 것만 보여요. ' : ''}<b>전화번호나 남겼을 것 같은 사람 이름</b>을 넣고 다시 찾으면 가족 쪽지를 더 정확히 찾아요.</p>
                      <div class="notes">${rest.map((r, i) => noteCard(r, i, false)).join('')}</div>
                    </details>`
                 : ''
             }`
          : `<div class="paper empty">
               <p><b>${hidden.length ? '보이는 쪽지가 없어요.' : '아직 남겨진 쪽지가 없어요.'}</b></p>
               <p>누군가 쪽지를 남기면 여기서 확인할 수 있어요. 가끔 다시 들러 보세요.</p>
             </div>`
      }
      ${
        hidden.length
          ? `<details class="hidden-notes">
               <summary>숨긴 쪽지 ${hidden.length}개</summary>
               <p class="hint">이 기기에서만 숨겨져 있어요. 다른 기기에서 찾으면 다시 보여요.</p>
               <div class="notes">${hidden.map((r, i) => noteCard(r, i, true)).join('')}</div>
             </details>`
          : ''
      }
      <div class="row2">
        <a class="btn" href="#/find">다른 정보로 다시 찾기</a>
        <a class="btn" href="#/write">내가 쪽지 남기기</a>
      </div>
    </section>
  `);
  for (const b of $$('[data-hide]')) {
    b.addEventListener('click', () => {
      device.setHidden(b.dataset.hide, b.dataset.on === '1');
      toast(b.dataset.on === '1' ? '이 기기에서 숨겼어요. 아래 "숨긴 쪽지"에서 다시 볼 수 있어요.' : '다시 보이게 했어요.');
      results();
    });
  }
}

// ---------- 퀴즈 풀기 ----------

function unlockView(id) {
  const data = loadResults();
  const r = data?.list.find((x) => x.box === id);
  if (!r) return (location.hash = '#/find');
  render(`
    <section class="paper">
      <p class="kicker">${r.type === 'room' ? `가족방 「${esc(r.teaser.title)}」` : '쪽지'}</p>
      <h1>질문에 답해 주세요</h1>
      <form id="f" novalidate>
        ${questions(r.teaser.q)
          .map(
            (q, i, all) => `
          <p class="q">Q${all.length > 1 ? i + 1 : ''}. ${esc(q)}</p>
          <label>답${all.length > 1 ? ` ${i + 1}` : ''} <input name="answer${i}" autocomplete="off" autocapitalize="off" required></label>`
          )
          .join('')}
        <p class="hint">띄어쓰기와 대소문자는 신경 쓰지 않아도 돼요.${
          questions(r.teaser.q).length > 1 ? ' 답을 모두 맞혀야 열려요.' : ''
        }</p>
        ${
          r.type === 'room'
            ? ''
            : `<p class="caution">남도 쉽게 알 만한 답이라면 사칭일 수 있어요. 열어 본 뒤에도 정말 그 사람인지 한 번 더 확인하세요.</p>`
        }
        <label class="check"><input type="checkbox" name="remember" checked>
          이 기기 기억하기 <span class="hint">다음부터 퀴즈 없이 열려요. 남의 기기라면 해제하세요.</span></label>
        <p class="error" id="err" hidden></p>
        <button class="btn primary big" type="submit">열기</button>
      </form>
    </section>
  `);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#err');
    const show = (t) => {
      err.textContent = t;
      err.hidden = false;
    };
    const qs = questions(r.teaser.q);
    const answers = qs.map((_, i) => f[`answer${i}`].value);
    if (answers.some((a) => !a.trim())) return show(qs.length > 1 ? '답을 모두 적어 주세요.' : '답을 적어 주세요.');
    err.hidden = true;
    busy('확인 중…');
    try {
      const { proof, wrap } = await C.quizKeys(qs.length > 1 ? answers : answers[0], r.salt);
      const nonce = await C.proofOfWork(r.box, proof);
      let res;
      try {
        res = await api.unlock(r.box, proof, nonce);
      } catch (e) {
        // 이 쪽지에 틀린 시도가 몰렸을 때만: 잠그지 않고 사람인지 확인한 뒤 다시 시도
        if (!(e instanceof ApiError && e.body.error === 'human')) throw e;
        busy('확인 중… 이 쪽지에 틀린 시도가 많아 사람인지 확인해요');
        res = await api.unlock(r.box, proof, nonce, await humanToken('unlock'));
      }
      const { wrapped } = res;
      const R = await C.unwrapBox(wrap, wrapped);
      if (!R) throw new Error('unwrap');
      session.put(id, { r: C.b64u.enc(R), type: r.type, remember: f.remember.checked });
      location.hash = `#/box/${id}`;
    } catch (e) {
      if (e instanceof ApiError && e.body.error === 'wrong') {
        const left = e.body.remaining;
        show(
          left > 0
            ? `${questions(r.teaser.q).length > 1 ? '맞지 않는 답이 있어요' : '답이 맞지 않아요'}.${
                left <= 5 ? ` 오늘 이 인터넷 연결에서 남은 기회: ${left}번` : ''
              }`
            : '답이 맞지 않아요. 오늘은 이 인터넷 연결에서 더 시도할 수 없어요. 내일 다시 시도해 주세요.'
        );
      } else if (e instanceof ApiError && e.body.error === 'closed') {
        show('받는 사람이 이 쪽지를 지웠어요. 더는 열 수 없어요.');
      } else if (e instanceof ApiError && e.body.error === 'hidden') {
        show('아직 숨어 있는 맞쪽지예요. 받는 사람도 보낸 사람에게 쪽지를 쓰면 열 수 있어요.');
      } else if (e instanceof ApiError && e.body.error === 'limit') {
        show('오늘은 이 인터넷 연결에서 더 시도할 수 없어요. 내일 다시 시도해 주세요.');
      } else if (e?.message === 'human' || e?.message === 'human_load' || e?.body?.error === 'human') {
        show('사람인지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      } else {
        show('연결이 불안정해요. 인터넷이 되는 곳에서 다시 시도해 주세요.');
      }
    } finally {
      busy();
    }
  });
}

// ---------- 안내 ----------

function about() {
  render(`
    <section class="paper prose">
      <h1>쪽지는 어떻게 지켜지나요?</h1>
      <p class="lede"><b>오작교 서버에는 읽을 수 있는 개인정보가 없습니다.</b>
        쪽지는 여러분의 기기 안에서 잠긴 뒤에 서버로 가고, 그 자물쇠를 여는 열쇠는 둘만 아는 질문의 답에서만 나옵니다.
        답과 열쇠는 어떤 경우에도 서버로 보내지 않습니다.</p>

      <h2>세 가지 원칙</h2>
      <ul>
        <li><b>기기에서 잠근다.</b> 메시지, 약속 장소, 보낸 사람 이름은 브라우저 안에서 암호화된 뒤에 보내집니다. 서버는 처음부터 끝까지 암호문만 다룹니다(종단간 암호화).</li>
        <li><b>열쇠는 서버에 없다.</b> 서버는 답도, 답에서 만든 열쇠도 받지 않습니다. 받는 것은 답이 맞는지 가려 줄 뿐 답으로 되돌릴 수 없는 확인값 하나입니다.</li>
        <li><b>누구의 쪽지인지도 모른다.</b> 이름·생일·전화번호는 기기에서 한 방향으로만 계산한 값으로 서버에 닿습니다. 서버는 두 값이 같은지만 비교할 수 있고, 원래 이름을 되살릴 수 없습니다.</li>
      </ul>

      <h2>서버에 남는 것과 남지 않는 것</h2>
      <ul>
        <li><b>남지 않는 것</b>: 이름, 생일, 전화번호, 질문, 답, 메시지, 약속 장소, IP 주소의 원래 값.</li>
        <li><b>남는 것</b>: 기기에서 계산한 되돌릴 수 없는 값, 잠긴 글(암호문), 쪽지를 만든 시각과 마지막 기록 시각.</li>
      </ul>
      <p>운영자도 같은 처지입니다. 저장소를 통째로 열어 봐도 보이는 것은 알아볼 수 없는 값과 암호문뿐이라,
        수사기관 등에서 자료를 요청해도 건넬 수 있는 것은 그것뿐입니다.</p>

      <h2>왜 열쇠 없이는 풀 수 없나요?</h2>
      <ul>
        <li><b>내용을 잠근 열쇠는 무작위 256비트입니다.</b> 답에서 만든 것이 아니라 쪽지를 쓸 때 기기가 무작위로 뽑은 열쇠로,
          은행과 메신저가 쓰는 표준 암호 <b>AES-256-GCM</b>으로 잠급니다. 열쇠 후보가 2<sup>256</sup>개라 지구의 모든 컴퓨터를 동원해 우주의 나이만큼 돌려도 다 넣어 볼 수 없습니다.
          암호 자체를 깨는 길은 없습니다.</li>
        <li><b>그 열쇠는 답으로 한 번 더 잠겨 있습니다.</b> 답을 열쇠로 바꾸는 계산(PBKDF2-SHA-256)을 일부러 20만 번 반복하게 해서,
          답 하나를 넣어 보는 데도 기기가 한참 일하게 했습니다.</li>
        <li><b>질문도 암호문입니다.</b> 받는 사람의 이름과 생일처럼 보낸 사람이 적은 정보에서 만든 열쇠로 잠겨 있어, 그 정보를 아는 사람의 기기에서만 풀립니다. 서버는 질문도 읽지 못합니다.</li>
        <li><b>바꿔치기도 불가능합니다.</b> AES-GCM은 잠긴 글이 한 글자라도 바뀌면 열리지 않습니다. 누가 저장소에서 내용을 고쳐도 열 때 바로 드러납니다.</li>
      </ul>

      <h2>그래서 공격자가 노리는 곳은 답입니다</h2>
      <p>암호를 깰 수 없으니 남는 길은 답을 하나씩 넣어 보는 것입니다. 오작교는 여기를 네 겹으로 막습니다.</p>
      <ul>
        <li><b>횟수 제한.</b> 답이 맞는지는 서버가 가립니다. 같은 인터넷 연결에서 한 쪽지에 하루 5번 넘게 틀리면 사람인지 확인(Cloudflare Turnstile)을 거쳐야 하고,
          30번을 넘으면 다음 날까지 막힙니다. 여러 연결에서 틀린 답이 한 쪽지에 10번 쌓여도 그 뒤는 모두 사람 확인을 거칩니다.</li>
        <li><b>작업 증명.</b> 시도할 때마다 기기가 1~2초짜리 계산을 풀어 와야 합니다. 사람에겐 잠깐이지만, 프로그램으로 수십만 번 넣어 보려면 그만큼의 컴퓨터 시간이 듭니다.</li>
        <li><b>서버 비밀 열쇠.</b> 답 확인값과 잠긴 열쇠는 서버만 아는 비밀 열쇠로 한 번 더 잠가 저장합니다. 이 비밀 열쇠는 저장소와 분리된 Cloudflare 비밀 설정에만 있어,
          <b>저장소가 통째로 유출돼도 그것만으로는 맞혀 보기를 시작할 수 없습니다.</b></li>
        <li><b>트래픽 방어.</b> 한 연결에서 10초에 10번을 넘는 요청은 Cloudflare가 차단하고, 자동화된 봇은 걸러 냅니다. 요청이 비정상적으로 몰리면 모든 요청에 사람 확인을 붙입니다.</li>
      </ul>
      <p>한계도 솔직히 말씀드립니다. 저장소와 서버 비밀 열쇠를 <b>둘 다</b> 빼낸 공격자라면, 사전에 나올 만한 흔한 답(음식 이름, 흔한 이름, 네 자리 숫자)은 컴퓨터로 맞혀 볼 수 있습니다.
        마지막 한 겹은 답의 유일함입니다.</p>
      <p class="caution"><b>이렇게 정하면 안전합니다.</b> 받는 사람만 알고, 가족 단톡방이나 SNS에 올라온 적 없는 답으로 정하세요.
        질문을 2개 쓰면 두 답을 모두 맞혀야 열려서 훨씬 단단해집니다.</p>

      <h2>누가 무엇을 볼 수 있나요?</h2>
      <ul>
        <li>받는 사람의 이름과 생일을 아는 사람은 <b>쪽지가 있다는 사실과 질문</b>까지 볼 수 있습니다. 질문에는 이름이나 속마음이 드러나지 않게 써 주세요.</li>
        <li><b>답을 맞힌 사람만</b> 보낸 사람, 메시지, 약속 장소, 마지막 기록을 볼 수 있습니다.</li>
        <li>가족방의 집결지는 <b>그룹장만</b> 바꿀 수 있습니다. 답을 알아낸 사람도 가짜 집결지를 올릴 수 없습니다.</li>
        <li><b>💌 맞쪽지</b>는 상대가 내 이름과 출생연도까지 알고 나에게 쪽지를 쓰기 전까지 검색에 나타나지 않고, 숨어 있는 동안은 답을 알아도 열 수 없습니다.
          서버는 이름을 모른 채 계산값이 같은지만 봅니다.</li>
        <li>스팸이나 욕설 쪽지는 답을 맞힌 받는 사람이 지울 수 있습니다. 지운 쪽지는 누구도 다시 찾을 수 없습니다.</li>
      </ul>

      <h2>개인정보 처리 (초안)</h2>
      <ul>
        <li>이름·생일·전화번호는 원문으로 받지 않습니다. 기기에서 계산한 값만 저장합니다.</li>
        <li>IP 주소는 저장하지 않습니다. 반복 시도를 세기 위해 날마다 바뀌는 해시값을 최대 하루 동안만 쓰고 지웁니다.</li>
        <li>접속 통계는 기기마다 하루 한 번 보내는 신호를 날짜별 숫자(접속 수, 국가, 유입 경로, 처음 연 화면)로만 더합니다. 누가 언제 왔는지는 남지 않습니다.</li>
        <li>데이터는 Cloudflare(해외 사업자)의 서버에 암호문으로 보관됩니다. Cloudflare는 인터넷 중계자로서 요청의 IP 주소와 시각을 봅니다.</li>
        <li>쪽지·가족방을 만들 때, 그리고 찾기나 답 시도가 비정상적으로 많을 때는 Cloudflare Turnstile로 사람인지 확인합니다. 이때 Cloudflare가 브라우저 정보를 확인하며, 오작교는 그 결과(통과 여부)만 받습니다.</li>
        <li>14세 미만 자녀는 보호자가 가족방 구성원으로 등록해 주세요.</li>
        <li>"이 기기 기억하기"를 고르면 열쇠가 이 기기 브라우저에 저장됩니다. 남의 기기에서는 고르지 마세요.</li>
      </ul>
      <p class="fine">오작교는 민간 서비스이며 정부·공공기관의 공식 대피 체계를 대신하지 않습니다. 실제 대피는 재난 문자와 공식 안내를 따르세요.</p>
    </section>
  `);
}

// ---------- 라우터 ----------

const currentHash = () => location.hash.replace(/^#/, '') || '/';

async function route() {
  const hash = currentHash();
  busy();
  // 화면 코드를 받는 사이 다른 화면으로 옮겼으면 그리지 않는다
  const open = async (file, fn, ...args) => {
    const mod = await load(file);
    if (mod && currentHash() === hash) return mod[fn](...args);
  };
  let m;
  if (hash === '/') return home();
  if (hash === '/support') {
    // 바닥글의 "후원" 링크: 첫 화면의 후원 묶음으로 바로 내려간다
    await home();
    $('.support')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (hash === '/find') return findForm();
  if (hash === '/results') return results();
  if (hash === '/write') return open('./write.js', 'writeNote');
  if (hash === '/room/new') return open('./write.js', 'createRoom');
  if (hash === '/about') return about();
  if (hash === '/admin') return open('./admin.js', 'decoyView'); // 미끼: 진짜처럼 보이지만 어떤 열쇠도 맞지 않는다
  if ((m = hash.match(/^\/unlock\/([\w-]+)$/))) return unlockView(m[1]);
  if ((m = hash.match(/^\/box\/([\w-]+)$/))) return open('./box.js', 'showBox', m[1]);
  if (await isAdminRoute(hash)) return open('./admin.js', 'adminView');
  location.hash = '#/';
}

// 운영 통계의 진짜 주소. 코드에는 주소 대신 해시만 둔다(소스를 읽어도 주소를 알 수 없게). 열쇠는 따로(ADMIN_KEY).
// 바꾸려면 node scripts/admin-route.mjs '/새주소' 로 해시를 만들어 여기에 넣는다. 주소는 문서에 적지 않는다.
const ADMIN_ROUTE_HASH = '46c15e4954119191097a02f6ab43ffd140ae82d20130ffa5fbafb198f7b5bd4e';
async function isAdminRoute(h) {
  let p = h;
  try {
    p = decodeURIComponent(h);
  } catch {}
  return (await C.sha256hex(`findme.admin.route:${p.normalize('NFC')}`)) === ADMIN_ROUTE_HASH;
}

// ---------- 접속 신호 ----------
// 기기마다 하루 한 번, 첫 화면을 그린 뒤 조용히 보낸다 (어드민 통계용). 서버에는 날짜별 숫자만 남는다.
// 보내는 것: 처음 온 기기인지, 어디서 왔는지(아는 사이트 이름만), 처음 연 화면. 국가는 서버가 Cloudflare에서 받는다.
const REF_SOURCES = [
  ['kakao', /kakao/], ['naver', /naver/], ['daum', /daum/], ['google', /google/], ['instagram', /instagram/],
  ['facebook', /facebook|fb\.com|messenger/], ['x', /twitter|t\.co$|x\.com$/], ['telegram', /telegram|t\.me$/], ['youtube', /youtu/],
];
const ENTRY_ROUTE = (() => {
  const h = currentHash();
  if (h === '/') return 'home';
  if (h === '/find') return 'find';
  if (h === '/results') return 'results';
  if (h === '/write') return 'write';
  if (h === '/room/new') return 'room';
  if (h === '/about') return 'about';
  if (h.startsWith('/box/')) return 'box';
  if (h.startsWith('/unlock/')) return 'unlock';
  return 'other';
})();
function refSource() {
  let host = '';
  try {
    host = new URL(document.referrer).hostname.toLowerCase();
  } catch {}
  if (!host || host === location.hostname) return 'direct';
  return REF_SOURCES.find(([, re]) => re.test(host))?.[0] || 'other';
}
function hello() {
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  let last = null;
  try {
    last = localStorage.getItem('findme.hello');
  } catch {}
  if (last === day) return;
  try {
    localStorage.setItem('findme.hello', day);
  } catch {}
  api.hello({ first: !last, ref: refSource(), route: ENTRY_ROUTE }).catch(() => {});
}

window.addEventListener('hashchange', route);
window.addEventListener('error', () => busy());
window.addEventListener('unhandledrejection', (e) => {
  busy();
  console.error(e.reason);
  toast('문제가 생겼어요. 다시 시도해 주세요.');
});
route();
setTimeout(hello, 1500);
// 후원 링크가 아직 없으면 바닥글의 "후원"도 감춘다
if (!SUPPORT.toss && !SUPPORT.kakao) $('#support-link')?.remove();

// 첫 화면을 다 받은 뒤에 등록한다. 서비스 워커가 나머지 화면을 받는 동안 첫 화면을 늦추지 않게.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
