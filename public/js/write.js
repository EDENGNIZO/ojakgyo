import * as C from './crypto.js';
import { api, device, ApiError } from './api.js';
import { $, $$, esc, render, busy, toast, idFields, wireIdFields, findRude, hasUrl, findContact, kbdLink } from './ui.js';
import { setupBlock, wireSetup } from './recovery.js';
import { mountPicker } from './map.js';
import { preloadHuman, humanToken } from './human.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

// 생일 입력 묶음을 읽는다. 문제가 있으면 { error }
export function readIdFields(form, prefix) {
  const kind = form[`${prefix}kind`].value;
  const raw = form[`${prefix}bd`].value.trim();
  const phoneRaw = form[`${prefix}phone`].value.trim();
  const out = {};
  if (kind === 'full') {
    if (!(out.ymd = C.normDate(raw))) return { error: '생일을 8자리 숫자로 적어 주세요. 예: 19950314' };
  } else if (kind === 'year') {
    if (!(out.year = C.normYear(raw))) return { error: '출생연도를 4자리로 적어 주세요. 예: 1995' };
  } else if (kind === 'md') {
    if (!(out.md = C.normMonthDay(raw))) return { error: '생일 월·일을 적어 주세요. 예: 0314' };
  }
  if (phoneRaw && !(out.phone = C.normPhone(phoneRaw))) return { error: '전화번호 형식을 확인해 주세요.' };
  const schoolRaw = form[`${prefix}school`]?.value.trim();
  if (schoolRaw) {
    // '서울고등학교'처럼 종류가 이름에 적혀 있으면 그 종류로 맞춘다
    const sel = form[`${prefix}schoolKind`];
    const kind = C.schoolKindOf(schoolRaw) || sel.value;
    if (!kind) return { error: '학교 종류(초·중·고·대)를 골라 주세요.' };
    sel.value = kind;
    const name = C.normSchool(kind, schoolRaw);
    if (!name) return { error: '학교 이름을 확인해 주세요. 예: 서울고등학교' };
    out.school = { kind, name };
  }
  return out;
}

// 장소 고르기 묶음 (지도 + 메모)
function placeBlock(prefix, { label = '약속 장소', memoPlaceholder = '예: ○○초등학교 정문 느티나무 아래, 매일 오후 3시에 기다릴게' } = {}) {
  return `
    <div class="place-block" data-prefix="${prefix}">
      <div class="search-row">
        <input data-act="q" enterkeyhint="search" autocomplete="off" placeholder="주소나 장소 이름 검색 (예: 망원초등학교)">
        <button type="button" class="btn small" data-act="search">검색</button>
      </div>
      <ul class="search-results" id="${prefix}results" hidden></ul>
      <div class="row2 pick">
        <button type="button" class="btn small" data-act="locate">내 위치로 찍기</button>
        <div class="picker" id="${prefix}map"></div>
      </div>
      <p class="hint pick-hint" id="${prefix}coord">검색하거나 내 위치·지도로 ${label}를 찍어 주세요. 지도는 데이터를 많이 써요 (100~300KB).</p>
      <label>장소 메모 <input name="${prefix}memo" maxlength="120" placeholder="${memoPlaceholder}">
        <span class="hint">지도가 안 열리는 상황에서도 찾아갈 수 있게 자세히 적어 주세요.</span></label>
    </div>`;
}

async function wirePlace(root, prefix) {
  const state = { point: null };
  const coord = $(`#${prefix}coord`, root);
  const picker = mountPicker($(`#${prefix}map`, root), null, (p) => {
    state.point = p;
    coord.textContent = p ? `찍은 위치: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '';
  });
  const block = $(`[data-prefix="${prefix}"]`, root);
  $('[data-act=locate]', block).addEventListener('click', async () => {
    coord.textContent = '위치를 찾는 중…';
    try {
      await picker.locate();
    } catch {
      coord.textContent = '';
      toast('위치를 알 수 없어요. 검색하거나 지도를 열어 직접 찍어 주세요.');
    }
  });

  // 주소·장소 검색 → 결과를 고르면 핀이 찍히고, 메모가 비어 있으면 채워 준다
  const qInput = $('[data-act=q]', block);
  const list = $(`#${prefix}results`, root);
  const search = async () => {
    const q = qInput.value.trim();
    if (q.length < 2) return toast('두 글자 이상 적어 주세요.');
    list.hidden = false;
    list.innerHTML = '<li class="hint">찾는 중…</li>';
    try {
      const { results } = await api.geocode(q);
      if (!results.length) {
        list.innerHTML = '<li class="hint">찾지 못했어요. 다른 이름이나 도로명 주소로 찾아보거나, 지도를 열어 직접 찍어 주세요.</li>';
        return;
      }
      list.innerHTML = results
        .map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(r.name)}</b><span>${esc(r.address)}</span></button></li>`)
        .join('');
      $$('button[data-i]', list).forEach((b) =>
        b.addEventListener('click', () => {
          const r = results[+b.dataset.i];
          picker.setPoint(r.lat, r.lng);
          const memo = $(`[name="${prefix}memo"]`, block);
          if (!memo.value.trim()) memo.value = r.name === r.address ? r.name : `${r.name} (${r.address})`;
          list.hidden = true;
        })
      );
    } catch (e) {
      list.innerHTML = `<li class="hint">${
        e instanceof ApiError && e.status === 429 ? '검색을 너무 많이 했어요. 잠시 뒤에 다시 해 주세요.' : '검색할 수 없어요. 지도를 열어 직접 찍어 주세요.'
      }</li>`;
    }
  };
  $('[data-act=search]', block).addEventListener('click', search);
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search();
    }
  });
  return state;
}

function readPlace(form, prefix, state) {
  const memo = form[`${prefix}memo`].value.trim();
  if (!memo) return { error: '장소 메모를 적어 주세요.' };
  return { place: state.point ? { ...state.point, memo } : { memo } };
}

// 질문은 답을 몰라도 보이는 글이라 짧게, 링크 없이
const Q_MAX = 50;

// 질문 묶음. 쪽지는 기본 1개(원하면 하나 더), 가족방은 3개. 여러 개면 모두 맞혀야 열림
// 질문을 고를 때 참고할 좋은 예·안 좋은 예. 눌러야 펼쳐진다 (화면을 길게 만들지 않게)
const EXAMPLES = {
  room: {
    good: [
      ['고모의 이름은?', '가족 모두가 아는 사람의 이름이라 기억해 내기 쉽고, 다른 사람은 맞히기 어려워요.'],
      ['할머니 성함은?', '가족은 다 알지만 지인은 거의 모르는 이름이에요.'],
      ['외삼촌의 이름은?', '아빠 쪽과 엄마 쪽 친척을 섞어 두면, 어느 한쪽 사람이 세 답을 다 알기는 어려워요.'],
      ['우리 집 첫 강아지 이름은?', '가족 모두가 기억하고 시간이 지나도 바뀌지 않는 이름이에요. 초코·보리처럼 흔한 이름이면 다른 질문을 고르세요.'],
    ],
    bad: [
      ['○○이 좋아하는 색깔은?', '답이 될 만한 것이 몇 가지뿐이라 하나씩 넣어 보면 맞혀져요.'],
      ['○○이 좋아하는 음식은?', '시기마다 바뀌고 식구마다 다르게 기억해서, 정작 가족이 못 열 수 있어요.'],
      ['○○이 살던 동네는?', '지인이나 이웃도 답을 알 수 있어요.'],
    ],
  },
  note: {
    good: [
      ['네 첫 반려동물 이름은?', '받는 사람은 바로 떠올리고, 시간이 지나도 바뀌지 않아요. 초코·보리처럼 흔한 이름이면 피하세요.'],
      ['네 외할머니 성함은? (성 포함 3글자)', '가족은 알지만 친구나 지인은 거의 몰라요.'],
      ['고2 때 매일 가던 분식집 이름은?', '받는 사람의 기억 속 고유한 이름이라 남이 짐작하기 어려워요.'],
    ],
    bad: [
      ['내가 부르던 너의 별명은?', '받는 사람은 보낸 사람이 누군지 모른 채 질문을 봐서, 누가 부르던 별명인지 알 수 없어요.'],
      ['네가 좋아하는 색깔은?', '답이 몇 가지뿐이라 하나씩 넣어 보면 맞혀져요.'],
      ['네 생일은?', '찾을 때 이미 넣는 정보라 남도 알 수 있어요.'],
    ],
  },
};
function quizExamples(kind) {
  const li = ([q, why]) => `<li><b>${q}</b><span>${why}</span></li>`;
  const { good, bad } = EXAMPLES[kind];
  return `
    <details class="eg good"><summary>좋은 질문 예</summary><ul>${good.map(li).join('')}</ul></details>
    <details class="eg bad"><summary>안 좋은 질문 예</summary><ul>${bad.map(li).join('')}</ul></details>`;
}

function quizBlock(placeholders, { note = false, extra = null } = {}) {
  const many = placeholders.length > 1;
  const pair = (ph, i, numbered) => `
    <div class="quiz-pair">
      <label>질문${numbered ? ` ${i + 1}` : ''} <input name="q${i}" maxlength="${Q_MAX}" placeholder="${ph}"></label>
      <label>답${numbered ? ` ${i + 1}` : ''} <input name="a${i}" maxlength="60" autocomplete="off" autocapitalize="off"></label>
      <p class="warn-line" data-warn="${i}" hidden></p>
    </div>`;
  return (
    (note
      ? `<p class="caution"><b>받는 사람이 스스로 아는 걸 물어보세요.</b> 받는 사람은 보낸 사람이 누군지 모른 채 질문을 봐요.</p>`
      : '') +
    placeholders.map((ph, i) => pair(ph, i, many)).join('') +
    (extra
      ? `<div id="extraQ" hidden>${pair(extra, placeholders.length, false)}</div>
         <div id="addQWrap">
           <button type="button" class="btn small ghost" id="addQ">+ 질문 하나 더 (더 안전하게)</button>
           <p class="hint">두 답을 모두 맞혀야 열려서, 한 가지를 우연히 아는 사람은 열 수 없어요.</p>
         </div>`
      : '') +
    `<p class="hint">${
      note
        ? '질문은 받는 사람의 이름·생일을 아는 남도 볼 수 있어요. 속마음은 남길 말에 적어 주세요.'
        : '가족 한 명의 이름과 생일을 아는 사람은 질문까지는 볼 수 있어요.'
    }
      답의 띄어쓰기·대소문자는 구분하지 않아요.${many ? ' 답을 모두 맞혀야 열려요.' : ''}</p>`
  );
}

function wireQuiz(root) {
  $$('[data-warn]', root).forEach((w) => {
    const a = $(`[name=a${w.dataset.warn}]`, root);
    a.addEventListener('input', () => {
      const msg = a.value.trim() ? C.answerWarning(a.value) : null;
      w.textContent = msg || '';
      w.hidden = !msg;
    });
  });
}

// 질문·답 읽기. 문제가 있으면 { error }
function readQuiz(form, n) {
  const qs = [];
  const as = [];
  for (let i = 0; i < n; i++) {
    const q = form[`q${i}`].value.trim();
    const a = form[`a${i}`].value;
    const label = n > 1 ? `${i + 1}번 ` : '';
    if (!q) return { error: `${label}질문을 적어 주세요.` };
    if (q.length > Q_MAX) return { error: `${label}질문은 ${Q_MAX}자 안으로 적어 주세요.` };
    if (hasUrl(q)) return { error: `${label}질문에는 인터넷 주소(http·www)를 넣을 수 없어요.` };
    const contact = findContact(q);
    if (contact) return { error: contactMessage(`${label}질문`, contact) };
    const rude = findRude(q);
    if (rude) return { error: rudeMessage(`${label}질문`, rude) };
    if (C.normAnswer(a).length < 2) return { error: `${label}답을 두 글자 이상으로 정해 주세요.` };
    qs.push(q);
    as.push(a);
  }
  return n > 1 ? { q: qs, a: as } : { q: qs[0], a: as[0] };
}

// 질문은 누구나 보지만, 남길 말은 답을 맞힌 사람만 본다
const contactMessage = (label, part) =>
  `${label}의 「${part}」 부분은 연락처(전화번호·메신저 ID)로 보여요. 질문은 누구나 볼 수 있으니, 연락처는 답을 맞힌 사람만 보는 '남길 말'에 적어 주세요.`;

// 받는 사람이 보게 될 글에 욕설이 있으면 어느 칸의 어느 낱말인지 알려 준다
const rudeMessage = (label, word) => `${label}의 「${word}」 부분이 욕설·비속어로 걸렸어요. 다른 말로 바꿔 주세요.`;

export function rudeCheck(fields) {
  for (const [label, v] of Object.entries(fields)) {
    const word = findRude(v);
    if (word) return rudeMessage(label, word);
  }
  return null;
}

function showError(text) {
  const err = $('#err');
  err.textContent = text;
  err.hidden = false;
  err.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function makeDoors(identities, teaser) {
  return Promise.all(
    identities.map(async ([, s]) => {
      const d = await C.door(s);
      return { door: d.id, teaser: await C.seal(d.key, teaser) };
    })
  );
}

// ---------- 쪽지 남기기 ----------

function createError(e, tooMany) {
  if (e instanceof ApiError && e.body.error === 'create_limit') {
    return '오늘 이 인터넷 연결에서 만들 수 있는 쪽지·가족방 50개를 다 썼어요. 내일 다시 시도해 주세요.';
  }
  if (e instanceof ApiError && e.status === 429) return tooMany;
  if (e?.message === 'human_load') return '보안 확인을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  if (e?.message === 'human' || (e instanceof ApiError && e.body.error === 'human')) {
    return '사람인지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  }
  return '연결이 불안정해요. 인터넷이 되는 곳에서 다시 시도해 주세요.';
}

export async function writeNote() {
  preloadHuman().catch(() => {});
  const root = render(`
    <section class="paper">
      <h1>쪽지 남기기</h1>
      <p class="lede">상대가 자기 이름과 생일로 찾아오면, 둘만 아는 질문의 답을 맞혀야 읽을 수 있어요.</p>
      <form id="f" novalidate>
        <fieldset>
          <legend><span class="num">1</span> 받는 사람 <span class="opt">쪽지를 받을 상대</span></legend>
          <label>받는 사람 이름 <input name="toName" maxlength="40" required placeholder="예: 이서연"></label>
          ${kbdLink()}
          ${idFields('to', { who: '받는 사람', school: true })}
        </fieldset>
        <fieldset class="me">
          <legend><span class="num">2</span> 보내는 사람 <span class="opt">나</span></legend>
          <label>내 이름 <input name="fromName" maxlength="40" required placeholder="예: 김민준">
            <span class="hint">답을 맞힌 사람에게만 보여요.</span></label>
          <details class="more" id="meMore">
            <summary>내 생일도 적기 <span class="opt">선택</span></summary>
            <label>내 생일 <input name="fromBd" inputmode="numeric" placeholder="예: 19950314">
              <span class="hint">적어 두면 폰을 바꿔도 내 이름과 생일로 이 쪽지를 다시 찾을 수 있어요.</span></label>
          </details>
        </fieldset>
        <fieldset>
          <legend><span class="num">3</span> 쪽지</legend>
          <label>남길 말 <textarea name="text" rows="5" maxlength="2000" required
            placeholder="예: 오랜만이야. 연락이 끊겨서 여기 남겨. 이 쪽지를 보면 답장 줘."></textarea>
            <span class="hint">끝에 둘만 아는 이야기를 한 줄 더하면 상대가 진짜 나인 걸 알아봐요.</span></label>
          <label class="check"><input type="checkbox" name="withPlace"> 약속 장소도 남기기
            <span class="hint">연락이 끊겨도 만날 수 있게 장소와 시간을 정해 두세요.</span></label>
          <div id="placeWrap" hidden>${placeBlock('p')}</div>
        </fieldset>
        <fieldset>
          <legend><span class="num">4</span> 둘만 아는 질문</legend>
          ${quizBlock(['예: 네 첫 반려동물 이름은?'], { note: true, extra: '예: 네 외할머니 성함은? (성 포함 3글자)' })}
          ${quizExamples('note')}
        </fieldset>
        <fieldset>
          <label class="check"><input type="checkbox" name="mutual"> <b>💌 맞쪽지로 보내기</b> <span class="opt">상대도 나에게 써야 열려요</span></label>
          <div class="hint" id="mutualHelp" hidden>
            <p>상대가 나에게 쪽지를 쓰기 전까지는 이 쪽지가 있다는 것조차 보이지 않아요.
              상대가 쓰는 순간, 서로의 쪽지가 함께 나타나요.</p>
            <p>상대도 나에게 쪽지를 쓸 때 <b>내 이름과 출생연도</b>(앞뒤 1년까지)를 알아야 열려요. 이름이 같은 다른 사람과 섞이지 않게요.</p>
            <p>두 사람이 서로의 이름을 성까지 똑같이 적어야 해요(띄어쓰기는 상관없어요). 받는 사람의 생일이나 출생연도도 꼭 적어 주세요.</p>
            <p>상대가 이 사이트를 모르면 영영 열리지 않을 수 있어요.</p>
            <p id="mutualBd"><b>내 생일을 꼭 적어 주세요.</b> 상대가 내 출생연도를 아는지 맞춰 보고, 나중에 열렸는지도 확인할 수 있어요.</p>
          </div>
        </fieldset>
        <p class="error" id="err" hidden></p>
        <button class="btn primary big" type="submit">쪽지 남기기</button>
      </form>
    </section>
  `);
  wireIdFields(root);
  wireQuiz(root);
  $('#addQ').addEventListener('click', () => {
    $('#extraQ').hidden = false;
    $('#addQWrap').remove();
    $('[name=q1]').focus();
  });
  const place = await wirePlace(root, 'p');
  const f = $('#f');
  f.withPlace.addEventListener('change', () => ($('#placeWrap').hidden = !f.withPlace.checked));
  const syncMutual = () => {
    $('#mutualHelp').hidden = !f.mutual.checked;
    if (f.mutual.checked) $('#meMore').open = true;
    $('#mutualBd').hidden = !!f.fromBd.value.trim();
  };
  f.mutual.addEventListener('change', syncMutual);
  f.fromBd.addEventListener('input', syncMutual);

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toName = f.toName.value.trim();
    const fromName = f.fromName.value.trim();
    const text = f.text.value.trim();
    if (!toName) return showError('받는 사람 이름을 적어 주세요.');
    const to = readIdFields(f, 'to');
    if (to.error) return showError(to.error);
    if (!fromName) return showError('내 이름을 적어 주세요.');
    const fromYmd = f.fromBd.value.trim() ? C.normDate(f.fromBd.value) : null;
    if (f.fromBd.value.trim() && !fromYmd) {
      $('#meMore').open = true;
      return showError('내 생일을 8자리 숫자로 적어 주세요. 예: 19950314');
    }
    if (!text) return showError('남길 말을 적어 주세요.');
    // 맞쪽지는 이름만으로 맞추면 동명이인끼리 섞인다. 서로 출생연도(앞뒤 1년)까지 알아야 열린다
    if (f.mutual.checked && !to.ymd && !to.year)
      return showError('맞쪽지는 받는 사람의 생일이나 출생연도(나이)를 알아야 보낼 수 있어요. 이름이 같은 다른 사람과 섞이지 않게요.');
    if (f.mutual.checked && !fromYmd) {
      $('#meMore').open = true;
      return showError('맞쪽지는 내 생일을 적어야 보낼 수 있어요. 상대가 내 이름과 출생연도까지 알고 쓸 때만 열려요.');
    }
    let p = null;
    if (f.withPlace.checked) {
      const r = readPlace(f, 'p', place);
      if (r.error) return showError(r.error);
      p = r.place;
    }
    const quiz = readQuiz(f, $('#extraQ').hidden ? 1 : 2);
    if (quiz.error) return showError(quiz.error);
    const rude = rudeCheck({ '받는 사람 이름': toName, '내 이름': fromName, '남길 말': text, '장소 메모': p?.memo });
    if (rude) return showError(rude);
    const { q, a } = quiz;
    $('#err').hidden = true;

    busy('쪽지를 봉하는 중…');
    try {
      const box = await C.newBox(a);
      const token = C.newToken();
      const now = Date.now();
      const mutual = f.mutual.checked;
      const identities = C.writerIdentities({ name: toName, ...to }, fromName);
      if (fromYmd) identities.push(['sent', C.identity.sent(fromName, fromYmd)]);
      const teaser = { t: 'note', q, at: thisMonth(), ...(mutual ? { m: 1 } : {}) };
      const doors = await makeDoors(identities, teaser);
      // 맞쪽지의 "내가 보낸 쪽지" 문은 내 이름·생일만 알면 누구나 연다. 상태만 보이게 질문을 빼고 봉한다
      if (mutual && fromYmd) {
        const own = await C.door(identities.at(-1)[1]);
        doors.at(-1).teaser = await C.seal(own.key, { t: 'note', at: teaser.at, m: 1 });
      }
      const entries = [
        { ct: await C.seal(box.content, { k: 'header', note: { from: fromName, to: toName, ...(mutual ? { mutual: true } : {}) }, ts: now }) },
        { ct: await C.seal(box.content, { k: 'post', name: fromName, text, place: p, ts: now }) },
      ];
      const human = await humanToken('create');
      const { id } = await api.create({
        human,
        type: 'note',
        salt: box.salt,
        verifier: box.verifier,
        wrapped: box.wrapped,
        accessHash: box.accessHash,
        doors,
        tokens: [{ hash: await C.sha256hex(token), role: 'owner', slot: 0 }],
        entries,
        // 맞쪽지: 상대(받는 사람)가 나에게 쪽지를 쓰면 생기는 "이름끼리" 출입문을 기다린다
        ...(mutual
          ? {
              mutual: {
                want: (await C.door(C.identity.pair(fromName, toName))).id,
                // 상대 쪽지가 내 출생연도 문(상대가 아는 연도의 앞뒤 1년)도 가져야 열린다
                wantYear: (await C.door(C.identity.year(fromName, fromYmd.slice(0, 4)))).id,
                always: fromYmd ? [identities.length - 1] : [],
              },
            }
          : {}),
      });
      device.put(id, {
        type: 'note', r: C.b64u.enc(box.R), token, slot: 0, role: 'owner', title: `${fromName} → ${toName}`,
      });
      noteDone({ id, access: box.access, token, content: box.content }, { toName, fromName, fromBd: f.fromBd.value.trim() }, mutual);
    } catch (e) {
      showError(createError(e, '오늘은 이 기기에서 쪽지를 너무 많이 만들었어요. 내일 다시 시도해 주세요.'));
    } finally {
      busy();
    }
  });
}

export function shareText() {
  return `혹시 누가 나를 찾고 있을까? 오작교에서 이름과 생일만 넣으면 나에게 남겨진 쪽지를 확인할 수 있어요. 전쟁이 나도 쪽지는 남아요. ${location.origin}`;
}

export const noteShareText = () =>
  `오작교에 쪽지를 남겨 두었어요. 연락이 끊기면 ${location.origin} 에서 이름과 생일로 찾아 주세요. 둘만 아는 질문에 답하면 열려요.`;
export const roomShareText = (title) =>
  `[오작교] 「${title}」 가족방을 만들었어요. 연락이 끊기면 여기서 집결지와 서로 안부를 확인해요.\n` +
  `${location.origin} → "나에게 남겨진 쪽지 확인" → 내 이름과 생일 → 가족만 아는 질문 3개`;

export async function share(text = shareText()) {
  try {
    if (navigator.share) return await navigator.share({ text });
    await navigator.clipboard.writeText(text);
    toast('복사했어요. 원하는 곳에 붙여 넣으세요.');
  } catch {}
}

// 도장에 찍을 오늘 날짜: 2026.11.03
const stampDate = (d = new Date()) =>
  `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

// 맞쪽지는 비밀이 제맛이라 공유 버튼을 두지 않는다
function noteDone(target, { toName, fromName, fromBd }, mutual) {
  render(`
    <section class="paper done">
      <p class="stamp" data-date="${stampDate()}">${mutual ? '숨김' : '남김'}</p>
      <h1>${mutual ? '맞쪽지를 숨겨 두었어요' : '쪽지를 남겼어요'}</h1>
      ${
        mutual
          ? `<p><b>${esc(toName)}</b>님이 나에게 쪽지를 쓰는 순간 이 쪽지가 나타나요. 그 전에는 아무도 이 쪽지가 있는지 몰라요.</p>`
          : `<p><b>${esc(toName)}</b>님이 오작교에서 자기 이름과 생일로 찾으면 질문이 보이고, 답을 맞히면 쪽지를 읽을 수 있어요.</p>`
      }
      <p class="caution">혹시 ${esc(toName)}님도 나에게 쪽지나 맞쪽지를 남겼다면, 지금 찾을 수 있어요.
        <a href="#/find" id="findBack">${esc(toName)}님이 남긴 쪽지 찾아보기</a></p>
      <ul class="plain">
        ${mutual ? '' : '<li>미리 알리고 싶다면 "상대에게 알리기"로 보내세요. 쪽지 내용과 답은 들어가지 않아요.</li>'}
        <li>몰래 남긴 쪽지라면 그대로 두세요. 상대가 언젠가 직접 찾아올 수 있어요.</li>
        <li>이 기기는 보낸 사람으로 기억돼서, 나중에 장소가 바뀌면 이어서 남길 수 있어요.</li>
      </ul>
      <div class="row2">
        ${mutual ? '' : '<button class="btn" id="share">상대에게 알리기</button>'}
        <a class="btn primary" href="#/box/${esc(target.id)}">내 쪽지 보기</a>
      </div>
      ${setupBlock('note')}
    </section>
  `);
  $('#share')?.addEventListener('click', () => share(noteShareText()));
  // 맞쪽지는 이름끼리 맞춰 열리니, 상대 이름을 "남겼을 것 같은 사람"에 넣어 찾아야 보인다
  $('#findBack').addEventListener('click', () => {
    try {
      sessionStorage.setItem('findme.prefill', JSON.stringify({ name: fromName, bd: fromBd, from: toName }));
    } catch {}
  });
  wireSetup(target);
}

// ---------- 가족방 만들기 ----------

function memberRow(i) {
  return `
    <div class="member-row" data-i="${i}">
      <div class="row2 tight">
        <strong>구성원</strong>
        <button type="button" class="btn small ghost" data-act="remove">빼기</button>
      </div>
      <label>이름 <input name="m${i}name" maxlength="40" placeholder="예: 김영희"></label>
      ${idFields(`m${i}`)}
    </div>`;
}

export async function createRoom() {
  preloadHuman().catch(() => {});
  let next = 0;
  const root = render(`
    <section class="paper">
      <h1>가족방 만들기</h1>
      <p class="lede">평소에 가족을 미리 연결해 두세요. 유사시 각자 자기 이름과 생일로 들어와 집결지와 서로의 상태를 확인합니다.</p>
      <form id="f" novalidate>
        <fieldset>
          <legend><span class="num">1</span> 가족방 이름</legend>
          ${kbdLink()}
          <label>이름 <input name="title" maxlength="30" required placeholder="예: 망원동 김씨네">
            <span class="hint">찾을 때 보이는 이름이에요. 주소나 실명 대신 가족끼리 알아볼 수 있는 이름으로 정해 주세요.</span></label>
        </fieldset>
        <fieldset>
          <legend><span class="num">2</span> 구성원</legend>
          <div class="member-row me">
            <strong>나 (그룹장)</strong>
            <label>내 이름 <input name="meName" maxlength="40" required placeholder="예: 김철수"></label>
            <label>내 생일 <input name="meBd" inputmode="numeric" required placeholder="예: 19680502"></label>
            <label>내 전화번호 <span class="opt">선택</span> <input name="mePhone" inputmode="tel" placeholder="예: 010-1234-5678"></label>
          </div>
          <div id="members"></div>
          <button type="button" class="btn" id="add">+ 구성원 추가</button>
        </fieldset>
        <fieldset>
          <legend><span class="num">3</span> 집결지</legend>
          ${placeBlock('p', { label: '집결지', memoPlaceholder: '예: 할머니 댁 앞 놀이터 (○○동 ○○아파트 정문)' })}
          <label>한마디 <span class="opt">선택</span>
            <input name="text" maxlength="300" placeholder="예: 연락이 끊기면 매일 오후 3시에 여기서 만나자"></label>
        </fieldset>
        <fieldset>
          <legend><span class="num">4</span> 가족만 아는 질문</legend>
          ${quizBlock(['예: 할아버지 성함은? (성 포함 3글자)', '예: 외할아버지 성함은? (성 포함 3글자)', '예: 이모의 이름은? (성 포함 3글자)'])}
          <p class="hint">가족 모두가 아는 것으로 정하세요. 아이나 사위·며느리도 답할 수 있어야 해요. 친척이나 동네 사람도 아는 답(부고·족보·SNS에 나온 이름)은 피하는 게 좋아요.</p>
          ${quizExamples('room')}
        </fieldset>
        <p class="fine">함께 관리할 사람(공동 그룹장)은 방을 만든 뒤 초대 코드로 지정해요.</p>
        <p class="error" id="err" hidden></p>
        <button class="btn primary big" type="submit">가족방 만들기</button>
      </form>
    </section>
  `);
  wireQuiz(root);
  const place = await wirePlace(root, 'p');
  const f = $('#f');
  const addMember = () => {
    const holder = document.createElement('div');
    holder.innerHTML = memberRow(next++);
    const row = holder.firstElementChild;
    $('#members').appendChild(row);
    wireIdFields(row);
    $('[data-act=remove]', row).addEventListener('click', () => row.remove());
  };
  $('#add').addEventListener('click', addMember);
  addMember();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = f.title.value.trim();
    const meName = f.meName.value.trim();
    const meYmd = C.normDate(f.meBd.value);
    const mePhone = f.mePhone.value.trim() ? C.normPhone(f.mePhone.value) : null;
    if (!title) return showError('가족방 이름을 적어 주세요.');
    if (!meName) return showError('내 이름을 적어 주세요.');
    if (!meYmd) return showError('내 생일을 8자리 숫자로 적어 주세요. 예: 19680502');
    if (f.mePhone.value.trim() && !mePhone) return showError('내 전화번호 형식을 확인해 주세요.');

    const members = [{ name: meName, ymd: meYmd, phone: mePhone }];
    for (const row of $$('#members .member-row')) {
      const i = row.dataset.i;
      const name = f[`m${i}name`].value.trim();
      if (!name) continue;
      const ids = readIdFields(f, `m${i}`);
      if (ids.error) return showError(`${name}: ${ids.error}`);
      if (!ids.ymd && !ids.year && !ids.md && !ids.phone) {
        return showError(`${name}: 생일, 나이, 전화번호 중 하나는 있어야 스스로 찾아올 수 있어요.`);
      }
      members.push({ name, ...ids });
    }
    if (members.length < 2) return showError('함께할 가족을 한 명 이상 추가해 주세요.');
    const pr = readPlace(f, 'p', place);
    if (pr.error) return showError(pr.error);
    const quiz = readQuiz(f, 3);
    if (quiz.error) return showError(quiz.error);
    if (hasUrl(title)) return showError('가족방 이름에는 인터넷 주소(http·www)를 넣을 수 없어요.');
    const contact = findContact(title);
    if (contact) return showError(contactMessage('가족방 이름', contact).replace("'남길 말'", "'한마디'"));
    const rude = rudeCheck({
      '가족방 이름': title,
      '구성원 이름': members.map((m) => m.name).join(' '),
      '한마디': f.text.value,
      '장소 메모': pr.place.memo,
    });
    if (rude) return showError(rude);
    const { q, a } = quiz;
    $('#err').hidden = true;

    busy('가족방을 만드는 중…');
    try {
      const box = await C.newBox(a);
      const token = C.newToken();
      const now = Date.now();
      const teaser = { t: 'room', q, title, n: members.length, at: thisMonth() };
      const identities = members.flatMap((m) => C.writerIdentities(m, null));
      const doors = await makeDoors(identities, teaser);
      const entries = [
        {
          ct: await C.seal(box.content, {
            k: 'header', room: { title, q, members: members.map((m) => ({ name: m.name })) }, ts: now,
          }),
        },
        {
          ct: await C.seal(box.content, {
            k: 'post', name: meName, official: true, place: pr.place, text: f.text.value.trim(), ts: now,
          }),
        },
      ];
      const human = await humanToken('create');
      const { id } = await api.create({
        human,
        type: 'room',
        salt: box.salt,
        verifier: box.verifier,
        wrapped: box.wrapped,
        accessHash: box.accessHash,
        doors,
        tokens: [{ hash: await C.sha256hex(token), role: 'admin', slot: 0 }],
        entries,
      });
      device.put(id, { type: 'room', r: C.b64u.enc(box.R), token, slot: 0, role: 'admin', title });
      render(`
        <section class="paper done">
          <p class="stamp" data-date="${stampDate()}">완성</p>
          <h1>가족방을 만들었어요</h1>
          <p>이제 가족에게 알려 주세요. 각자 자기 이름과 생일로 찾아 세 질문의 답을 맞히면 들어와요.</p>
          <blockquote class="share-preview">${esc(roomShareText(title)).replace(/\n/g, '<br>')}</blockquote>
          <button class="btn big" id="share">가족에게 보내기</button>
          <p class="fine">답은 들어가지 않아요. 가족 단톡방에 그대로 보내도 돼요.</p>
          ${setupBlock('room')}
          <a class="btn primary big" href="#/box/${esc(id)}">가족방 열기</a>
        </section>`);
      $('#share').addEventListener('click', () => share(roomShareText(title)));
      wireSetup({ id, access: box.access, token, content: box.content });
    } catch (e) {
      showError(createError(e, '오늘은 이 기기에서 너무 많이 만들었어요. 내일 다시 시도해 주세요.'));
    } finally {
      busy();
    }
  });
}

export { makeDoors, placeBlock, wirePlace, readPlace };
