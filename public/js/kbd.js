// 화면 한글 자판 (두벌식). 한글 자판이 없는 기기(빌린 외국 폰·PC)에서도 이름·답·글을 한글로 쓰게 한다.
// - 양식의 "화면 자판 열기"를 누를 때만 받는다. 평소 화면과 무게는 그대로.
// - 켜 둔 동안 글자 칸은 기기 자판 대신 이 자판으로 쓴다(inputmode=none). 생일·전화번호 같은 숫자 칸은 기기 자판 그대로.
// - 실제 키보드가 있는 PC에서는 영문 자판 자리 그대로 한글이 써진다(q→ㅂ, w→ㅈ …, Shift+q→ㅃ).
// - 켜 둔 상태는 이 탭에서만 기억한다(sessionStorage). 빌린 기기 주인에게 남지 않게.
// - 한글 조합은 이 파일 안에서 한다. 바깥 라이브러리 없음.

// ---------- 한글 조합 (화면과 상관없는 부분. node에서 시험할 수 있다) ----------

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const VOWEL_PAIR = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const FINAL_PAIR = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ',
  'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
};
// 겹모음·겹받침을 둘로 나누는 표 (ㄺ → ㄹ, ㄱ)
const SPLIT = Object.fromEntries(Object.entries({ ...VOWEL_PAIR, ...FINAL_PAIR }).map(([two, one]) => [one, [...two]]));
const isVowel = (j) => JUNG.includes(j);

// 조합 중인 한 글자: { c: 첫소리, v: 가운뎃소리, f: 받침 } (없으면 '')
export function glyph({ c, v, f }) {
  if (c && v) return String.fromCharCode(0xac00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(v)) * 28 + JONG.indexOf(f));
  return c || v || '';
}

// 조합 중인 글자 s(없으면 null)에 자모 j를 더한다.
// 돌려주는 값 [prev, cur]: prev가 있으면 앞 글자는 prev로 끝나고 cur가 새로 조합을 시작한다. prev가 null이면 cur가 s를 대신한다.
export function addJamo(s, j) {
  const blank = { c: '', v: '', f: '' };
  if (!s) return [null, isVowel(j) ? { ...blank, v: j } : { ...blank, c: j }];
  if (isVowel(j)) {
    if (s.f) {
      // 받침이 다음 글자의 첫소리로 넘어간다 (갈+ㅏ → 가라, 닭+ㅏ → 달가)
      const [keep, move] = SPLIT[s.f] || ['', s.f];
      return [{ ...s, f: keep }, { c: move, v: j, f: '' }];
    }
    if (s.v) {
      const pair = VOWEL_PAIR[s.v + j];
      return pair ? [null, { ...s, v: pair }] : [s, { ...blank, v: j }];
    }
    return [null, { ...s, v: j }];
  }
  if (s.c && s.v && !s.f && JONG.includes(j)) return [null, { ...s, f: j }]; // ㄸ·ㅃ·ㅉ은 받침이 될 수 없다
  if (s.f && FINAL_PAIR[s.f + j]) return [null, { ...s, f: FINAL_PAIR[s.f + j] }];
  return [s, { ...blank, c: j }];
}

// 조합 중인 글자에서 마지막 자모 하나를 지운다. 다 지워지면 null
export function backJamo(s) {
  if (s.f) return { ...s, f: SPLIT[s.f]?.[0] || '' };
  if (s.v) {
    if (SPLIT[s.v]) return { ...s, v: SPLIT[s.v][0] };
    return s.c ? { ...s, v: '' } : null;
  }
  return null;
}

// 자모를 차례로 넣어 본 결과 (시험용)
export function typeAll(jamos) {
  let out = '';
  let s = null;
  for (const j of jamos) {
    if (j === ' ') {
      out += (s ? glyph(s) : '') + ' ';
      s = null;
      continue;
    }
    const [prev, cur] = addJamo(s, j);
    if (prev) out += glyph(prev);
    s = cur;
  }
  return out + (s ? glyph(s) : '');
}

// ---------- 화면 자판 ----------

const KEY = 'findme.kbd';
const ROWS = ['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ', 'ㅋㅌㅊㅍㅠㅜㅡ'];
const SHIFTED = { 'ㅂ': 'ㅃ', 'ㅈ': 'ㅉ', 'ㄷ': 'ㄸ', 'ㄱ': 'ㄲ', 'ㅅ': 'ㅆ', 'ㅐ': 'ㅒ', 'ㅔ': 'ㅖ' };
const SYMBOLS = ['1234567890', '-/:;()~&@"', ".,?!'%*+#"];
// 실제 키보드의 영문 자리 → 두벌식 (q w e r … = ㅂ ㅈ ㄷ ㄱ …)
const QWERTY = 'qwertyuiopasdfghjklzxcvbnm';
const DUBEOL = ROWS.join('');
const JAMO = new Set([...DUBEOL, ...Object.values(SHIFTED)]);

const FIELD = 'input:not([type]), input[type=text], input[type=search], textarea';
let on = false;
let panel = null;
let target = null; // 지금 쓰는 칸
let comp = null; // 조합 중: { el, pos, s }
let shift = false;
let layer = 'ko';
let observer = null;

// 화면에 보이는 칸인지. 닫힌 <details> 안의 칸은 사파리에서 offsetParent가 남아 있어 따로 본다
const shown = (el) =>
  !el.closest('details:not([open]) > :not(summary)') && (el.checkVisibility ? el.checkVisibility() : !!el.offsetParent);

// 이 자판으로 쓸 칸: 글자 칸이면서 숫자 자판 표시(inputmode)가 없는 것. 초대 코드처럼 영문을 쓰는 칸은 data-nokbd로 뺀다
const fits = (el) =>
  el instanceof HTMLElement &&
  el.matches(FIELD) &&
  !el.closest('#kbd') &&
  !el.hasAttribute('data-nokbd') &&
  !el.readOnly &&
  !el.disabled &&
  (!el.hasAttribute('inputmode') || el.dataset.kbd === '1');

function mark() {
  document.querySelectorAll(FIELD).forEach((el) => {
    if (!el.dataset.kbd && fits(el)) {
      el.dataset.kbd = '1';
      el.setAttribute('inputmode', 'none');
    }
  });
}
function unmark() {
  document.querySelectorAll('[data-kbd]').forEach((el) => {
    el.removeAttribute('inputmode');
    delete el.dataset.kbd;
  });
}

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const key = (k, label = k, cls = '', aria = '') =>
  `<button type="button" class="k${cls ? ` ${cls}` : ''}" data-k="${attr(k)}"${aria ? ` aria-label="${aria}"` : ''}>${attr(label)}</button>`;

function draw() {
  const rows =
    layer === 'ko'
      ? [
          [...ROWS[0]].map((j) => key(shift ? SHIFTED[j] || j : j)).join(''),
          [...ROWS[1]].map((j) => key(j)).join(''),
          key('shift', '⇧', `fn${shift ? ' on' : ''}`, '쌍자음') + [...ROWS[2]].map((j) => key(j)).join('') + key('back', '⌫', 'fn', '지우기'),
        ]
      : [
          [...SYMBOLS[0]].map((c) => key(c)).join(''),
          [...SYMBOLS[1]].map((c) => key(c)).join(''),
          [...SYMBOLS[2]].map((c) => key(c)).join('') + key('back', '⌫', 'fn', '지우기'),
        ];
  panel.innerHTML = `
    <div class="kbd-bar"><span>화면 한글 자판${matchMedia('(pointer: fine)').matches ? ' · 실제 키보드도 한글로 써져요' : ''}</span>${key('close', '닫기', 'kbd-close', '화면 자판 닫기')}</div>
    ${rows.map((r, i) => `<div class="kbd-row${i === 1 && layer === 'ko' ? ' r2' : ''}">${r}</div>`).join('')}
    <div class="kbd-row">${key('layer', layer === 'ko' ? '123' : '가', 'fn', layer === 'ko' ? '숫자·기호' : '한글')}${key(',')}${key(' ', '띄어쓰기', 'space')}${key('.')}${key('enter', '↵', 'fn', '다음')}</div>`;
}

function build() {
  panel = document.createElement('div');
  panel.id = 'kbd';
  panel.className = 'kbd';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '화면 한글 자판');
  // 자판을 눌러도 글자 칸에서 커서가 빠져나가지 않게
  panel.addEventListener('pointerdown', (e) => e.preventDefault());
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  // 손가락은 뗄 때 바로 쓴다. 꾹 오래 눌러도 써지게 (아이폰·안드로이드는 오래 누르면 click을 보내지 않는다)
  // 손가락 뒤에 따라오는 click은 막는다. 닫기로 자판이 사라진 자리 아래의 버튼이 눌리지 않게
  let touchedAt = 0;
  if ('PointerEvent' in window) {
    panel.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      touchedAt = Date.now();
      onKey(e);
    });
    panel.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
  }
  panel.addEventListener('click', (e) => {
    if (Date.now() - touchedAt > 800) onKey(e); // 마우스·키보드로 누른 것 (손가락은 위에서 이미 썼다)
  });
  panel.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.append(panel);
  draw();
}

function show() {
  if (!panel) build();
  panel.hidden = false;
  document.documentElement.classList.add('kbd-show');
  document.documentElement.style.setProperty('--kbd-h', `${panel.offsetHeight}px`);
  // 쓰는 칸이 자판에 가리지 않게
  requestAnimationFrame(() => {
    if (!target?.isConnected) return;
    const r = target.getBoundingClientRect();
    const bottom = innerHeight - panel.offsetHeight - 12;
    if (r.bottom > bottom) scrollBy({ top: r.bottom - bottom, behavior: 'smooth' });
    else if (r.top < 64) scrollBy({ top: r.top - 64, behavior: 'smooth' });
  });
}
function hide() {
  if (panel) panel.hidden = true;
  document.documentElement.classList.remove('kbd-show');
}

const caret = (el) => [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length];

// 조합이 이어지는지: 같은 칸, 커서가 그 자리 그대로, 그 앞 글자가 조합 중인 글자 그대로
function live(el) {
  if (!comp || comp.el !== el) return null;
  const [a, z] = caret(el);
  return a === z && a === comp.pos && el.value[a - 1] === glyph(comp.s) ? comp.s : null;
}

function put(el, text, from, to) {
  if (el.maxLength > 0 && el.value.length - (to - from) + text.length > el.maxLength) return false;
  el.setRangeText(text, from, to, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function typeJamo(el, j) {
  const s = live(el);
  const [a, z] = caret(el);
  const [prev, cur] = addJamo(s, j);
  const text = (s && prev ? glyph(prev) : '') + glyph(cur);
  if (!put(el, text, s ? a - 1 : a, s ? a : z)) return;
  comp = { el, pos: el.selectionStart, s: cur };
}

function backspace(el) {
  const s = live(el);
  const [a, z] = caret(el);
  if (s) {
    const rest = backJamo(s);
    put(el, rest ? glyph(rest) : '', a - 1, a);
    comp = rest ? { el, pos: el.selectionStart, s: rest } : null;
    return;
  }
  comp = null;
  if (a !== z) put(el, '', a, z);
  else if (a > 0) put(el, '', /[\udc00-\udfff]/.test(el.value[a - 1]) && a > 1 ? a - 2 : a - 1, a);
}

function insert(el, text) {
  comp = null;
  const [a, z] = caret(el);
  put(el, text, a, z);
}

// ↵: 여러 줄 칸은 줄바꿈, 한 줄 칸은 다음 칸으로. 마지막 칸이면 양식을 보낸다
// 칸이 Enter를 따로 쓰면(주소 검색 칸은 Enter로 검색) 그 동작을 따른다
function enter(el) {
  comp = null;
  if (el.tagName === 'TEXTAREA') return insert(el, '\n');
  if (!el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))) return;
  const form = el.form;
  if (!form) return;
  const items = [...form.elements].filter(
    (x) => x.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select') && !x.disabled && shown(x)
  );
  const next = items[items.indexOf(el) + 1];
  if (next) next.focus();
  else form.requestSubmit();
}

function onKey(e) {
  const b = e.target.closest('[data-k]');
  if (!b) return;
  const k = b.dataset.k;
  if (k === 'close') return disable();
  if (k === 'shift' || k === 'layer') {
    if (k === 'shift') shift = !shift;
    else {
      layer = layer === 'ko' ? 'sym' : 'ko';
      shift = false;
    }
    return draw();
  }
  const el = target?.isConnected ? target : null;
  if (!el) return;
  if (document.activeElement !== el) {
    const [a, z] = caret(el);
    el.focus({ preventScroll: true });
    el.setSelectionRange(a, z);
  }
  if (k === 'back') backspace(el);
  else if (k === 'enter') enter(el);
  else if (JAMO.has(k)) typeJamo(el, k);
  else insert(el, k);
  if (shift) {
    shift = false;
    draw();
  }
}

function onFocus(e) {
  const el = e.target;
  if (panel?.contains(el)) return;
  if (fits(el)) {
    if (!el.dataset.kbd) mark();
    target = el;
    show();
  } else if (el.matches?.('input, textarea, select')) {
    hide(); // 숫자 칸 등은 기기 자판으로
  }
}

// 실제 키보드: 영문 자리를 두벌식으로
function onKeydown(e) {
  const el = e.target;
  if (!fits(el) || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    const j = DUBEOL[QWERTY.indexOf(e.key.toLowerCase())];
    target = el;
    typeJamo(el, e.shiftKey ? SHIFTED[j] || j : j);
  } else if (e.key === 'Backspace' && live(el)) {
    e.preventDefault();
    backspace(el);
  } else if (e.key !== 'Shift') {
    comp = null;
  }
}

function watch() {
  mark();
  // 화면이 바뀌어 쓰던 칸이 사라지면 자판을 내린다
  if (target && !target.isConnected) {
    target = null;
    comp = null;
    hide();
  }
}

// from: 누른 "화면 자판 열기" 링크. 그 양식의 빈 글자 칸(없으면 링크 바로 앞 칸)으로 간다
export function enable(from) {
  if (!on) {
    on = true;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {}
    mark();
    observer = new MutationObserver(watch);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKeydown, true);
    document.documentElement.classList.add('kbd-on');
  }
  if (!from) return;
  const scope = from.closest('form, section') || document;
  const all = [...scope.querySelectorAll(FIELD)].filter((el) => fits(el) && shown(el));
  const before = all.filter((el) => el.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING);
  // 쓰던 칸이 있으면 그 칸, 없으면 이 양식의 빈 칸, 그것도 없으면 링크 바로 앞 칸
  const was = document.activeElement;
  const typing = was instanceof HTMLElement && was.matches('input, textarea');
  const el = (typing && all.includes(was) ? was : null) || all.find((x) => !x.value) || before.at(-1) || all[0];
  if (!el) return;
  target = el;
  show();
  if (typing && matchMedia('(pointer: coarse)').matches) {
    // 휴대폰에서 기기 자판이 떠 있던 칸: 먼저 놓아서 기기 자판을 내리고, 다 내려간 뒤에 다시 잡는다.
    // 아이폰은 잡힌 칸의 inputmode 바뀜을 보지 않고, 놓자마자 다시 잡으면 기기 자판을 그대로 둔다
    was.blur();
    setTimeout(() => {
      if (on && target === el && el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
    }, 350);
  } else if (document.activeElement !== el) el.focus({ preventScroll: true });
}

export function disable() {
  on = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  observer?.disconnect();
  document.removeEventListener('focusin', onFocus);
  document.removeEventListener('keydown', onKeydown, true);
  unmark();
  hide();
  panel?.remove();
  panel = null;
  comp = null;
  shift = false;
  layer = 'ko';
  document.documentElement.classList.remove('kbd-on');
  // 기기 자판으로 이어 쓰게 칸을 다시 잡는다
  const el = target;
  target = null;
  if (el?.isConnected) {
    el.blur();
    el.focus();
  }
}
