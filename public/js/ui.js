// 화면 공통 도구

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function render(html) {
  const app = $('#app');
  app.innerHTML = html;
  window.scrollTo(0, 0);
  return app;
}

// 기다리는 동안 화면을 잠근다. 덮개만 씌우면 키보드의 Enter(다음)로 같은 양식이 한 번 더 제출된다
// (퀴즈 기회가 두 번 깎이거나 쪽지가 두 장 만들어진다).
export function busy(text) {
  const el = $('#busy');
  const app = $('#app');
  if (!text) {
    el.hidden = true;
    app.inert = false;
    return;
  }
  $('#busy-text').textContent = text;
  el.hidden = false;
  app.inert = true;
  if (app.contains(document.activeElement)) document.activeElement.blur();
}

// 보내 온 글의 좌표·상태는 답을 아는 누구나 꾸밀 수 있으니, 모양이 맞을 때만 쓴다
export const hasCoord = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

export function ago(ts) {
  if (!ts) return '기록 없음';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}일 전`;
  return `${Math.floor(s / 86400 / 30)}개월 전`;
}

export function when(ts) {
  const d = new Date(ts);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${thisYear ? '' : d.getFullYear() + '년 '}${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

export const STATUS = {
  safe: { label: '무사해요', cls: 'st-safe' },
  moving: { label: '이동 중이에요', cls: 'st-moving' },
  arrived: { label: '도착했어요', cls: 'st-arrived' },
  help: { label: '도움이 필요해요', cls: 'st-help' },
};
export const statusOf = (s) => (typeof s === 'string' && Object.hasOwn(STATUS, s) ? STATUS[s] : null);

export const BADGE = {
  owner: '<span class="badge ok">✅ 보낸 사람 기기</span>',
  admin: '<span class="badge admin">📌 그룹장</span>',
  device: '<span class="badge ok">✅ 기억된 기기</span>',
  new: '<span class="badge warn">⚠️ 새 기기</span>',
  latest: '<span class="badge latest">제일 최근 기록</span>',
};

// 한글 자판이 없는 기기(빌린 외국 폰·PC)를 위한 화면 자판을 여는 링크. 누를 때만 kbd.js를 받는다(app.js가 받아 켠다)
export const kbdLink = () => '<button type="button" class="kbd-open" data-kbd-open>한글 자판이 없나요? 화면 자판 열기</button>';

// 생일을 아는 정도에 따라 입력 칸이 바뀌는 묶음
// who: 누구의 정보인지 칸 이름에 붙인다(쪽지 쓰기에서 받는 사람 칸과 내 칸이 헷갈리지 않게)
export function idFields(prefix, { required = false, who = '' } = {}) {
  const of = who ? `${who} ` : '';
  return `
    <div class="idfields" data-prefix="${prefix}">
      <label>${of}생일을 얼마나 아나요?
        <select name="${prefix}kind">
          <option value="full">정확히 알아요</option>
          <option value="year">나이(출생연도)만 알아요</option>
          <option value="md">생일(월·일)만 알아요</option>
          ${required ? '' : '<option value="none">몰라요</option>'}
        </select>
      </label>
      <input name="${prefix}bd" inputmode="numeric" autocomplete="off" placeholder="예: 19950314">
      <label>${of}전화번호 <span class="opt">선택</span>
        <input name="${prefix}phone" inputmode="tel" autocomplete="off" placeholder="예: 010-1234-5678">
      </label>
    </div>`;
}

const BD_PLACEHOLDER = { full: '예: 19950314', year: '예: 1995 (앞뒤 1년까지 함께 찾아요)', md: '예: 0314', none: '' };

export function wireIdFields(root) {
  for (const box of $$('.idfields', root)) {
    const p = box.dataset.prefix;
    const sel = $(`[name="${p}kind"]`, box);
    const bd = $(`[name="${p}bd"]`, box);
    const sync = () => {
      bd.placeholder = BD_PLACEHOLDER[sel.value];
      bd.hidden = sel.value === 'none';
    };
    sel.addEventListener('change', sync);
    sync();
  }
}

// ---------- 쓰는 글 거르기 ----------
// 쓰기 화면에서만 거른다. 서버는 암호문만 받아 내용을 볼 수 없으므로, 마음먹고 우회하는 것까지 막지는 못한다.
// 숫자·기호를 끼워 넣어도 걸리도록 낱말마다 한글·영문만 남겨 비교한다.
// 띄어쓰기를 모두 지우고 비교하면 "아저씨 발", "개 같이", "3시 발산역"처럼 낱말 경계를 넘어 걸린다.
const RUDE =
  /씨[발바빨팔]|시발|시팔|씌발|쓰발|썅|쌍[년놈]|개[새색쌔]|개세끼|개같|개놈|[병븅빙]신|좆|존나|지랄|염병|엠창|느금|니애미|미친[년놈새]|닥쳐|창녀|섹스|씹[새년할창]|등신|ㅅㅂ|ㅆㅂ|ㅄ|ㅂㅅ|ㅈㄹ|fuck|fck|shit|bitch|asshole/;
// 욕이 아닌데 걸리는 말
const NOT_RUDE = /시발점|시발역|시발산|등신대/g;

// 걸린 낱말을 쓴 그대로 돌려준다(없으면 null). 어디를 고쳐야 하는지 알려 주려고.
export function findRude(s) {
  const words = (s || '')
    .normalize('NFC')
    .split(/\s+/)
    .map((raw) => ({ raw, w: raw.toLowerCase().replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '').replace(NOT_RUDE, '') }))
    .filter((x) => x.w);
  // 한 글자씩 띄어 쓴 것(씨 발, ㅅ ㅂ, f u c k)은 이어 붙여 본다
  const spread = [];
  let run = [];
  for (const x of [...words, { w: '' }]) {
    if (x.w.length === 1) run.push(x);
    else if (run.length) {
      spread.push({ raw: run.map((r) => r.raw).join(' '), w: run.map((r) => r.w).join('') });
      run = [];
    }
  }
  const hit = [...words, ...spread].find((x) => RUDE.test(x.w));
  return hit ? hit.raw.slice(0, 20) : null;
}

// 질문에 링크를 넣어 광고·피싱으로 쓰지 못하게
export const hasUrl = (s) => /https?|www\./.test((s || '').toLowerCase().replace(/\s/g, ''));

// 질문(과 가족방 이름)은 퀴즈를 풀기 전에 누구나 본다. 연락처를 넣어 광고로 뿌리지 못하게 막고,
// 연락처는 답을 맞힌 사람만 보는 "남길 말"에 쓰도록 안내한다. 걸린 부분을 돌려준다(없으면 null).
const CONTACT = /t\.me|open\.kakao|오픈채팅|오픈톡|텔레그램|telegram|카톡아이디|카톡id|카카오아이디|카카오id|위챗|wechat|아이디|@[a-z0-9_]{3,}/;
export function findContact(s) {
  const t = (s || '').normalize('NFC').toLowerCase();
  const digits = t.replace(/[\s\-.()]/g, '').match(/\d{7,}/);
  if (digits) return digits[0].slice(0, 20);
  // 띄어 쓴 "카톡 아이디"도 걸리게 붙여서 본다. 영문 ID만은 낱말로 따로 본다(kid, did는 놔두게)
  const m = t.replace(/\s/g, '').match(CONTACT) || t.match(/(?<![a-z])id(?![a-z])/);
  return m ? m[0] : null;
}
