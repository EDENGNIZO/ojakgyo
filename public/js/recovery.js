// 복구 질문: 보낸 사람·그룹장이 폰을 잃어버리면, 다른 기기에서 쪽지(가족방)를 연 뒤
// "나만 아는 질문 3개"의 답을 모두 맞혀 권한을 되찾는다. 잃어버린 폰의 권한은 끊긴다.
// 질문은 방 열쇠로 암호화해 두고, 서버에는 답의 검증값만 보낸다.

import * as C from './crypto.js';
import { api, device, session, ApiError } from './api.js';
import { $, esc, busy, toast, render, kbdLink } from './ui.js';
import { humanToken } from './human.js';

const EXAMPLES = ['예: 내가 나온 초등학교 이름은?', '예: 내 외할머니 성함은?', '예: 내 첫 반려동물 이름은?'];

function qaFields(prefix, questions) {
  return [0, 1, 2]
    .map(
      (i) => `
      <div class="quiz-pair">
        ${
          questions
            ? `<p class="q">${esc(questions[i])}</p>`
            : `<label>질문 ${i + 1} <input name="${prefix}q${i}" maxlength="80" placeholder="${EXAMPLES[i]}"></label>`
        }
        <label>${questions ? '' : `답 ${i + 1} `}<input name="${prefix}a${i}" maxlength="60" autocomplete="off" autocapitalize="off"
          ${questions ? `aria-label="답 ${i + 1}" placeholder="답"` : ''}></label>
      </div>`
    )
    .join('');
}

// ---------- 만들기·바꾸기 (보낸 사람·그룹장 기기) ----------

export function setupBlock(kind, { has = false } = {}) {
  const who = kind === 'note' ? '보낸 사람' : '그룹장';
  const body = `
    <form id="rcf" novalidate>
      <p class="hint">폰을 잃어버리거나 바꿔도, 다른 기기에서 이 ${kind === 'note' ? '쪽지를' : '가족방을'} 연 뒤
        <b>세 답을 모두 맞히면</b> ${who} 권한을 되찾을 수 있어요. 잃어버린 폰의 권한은 그때 끊겨요.</p>
      ${qaFields('r')}
      <p class="hint">스스로 반드시 기억할 수 있는 답을 적어야 해요. 잊어버리면 다시 접속하지 못해요. (이 ${kind === 'note' ? '쪽지를' : '가족방을'} 연 사람도 질문을 볼 수 있어요.)</p>
      <p class="error" id="rcErr" hidden></p>
      <div class="row2">
        <button class="btn primary" type="submit">${has ? '바꾸기' : '저장'}</button>
        ${has ? '' : '<button class="btn ghost" type="button" id="rcLater">나중에</button>'}
      </div>
    </form>`;
  return has
    ? `<details class="recovery"><summary>복구 질문 바꾸기</summary>${body}</details>`
    : `<div class="recovery" id="rcBox"><p class="rc-title">나만 아는 질문 3개 만들기</p>${body}</div>`;
}

// target: { id, access, token, content }
export function wireSetup(target, { onSaved } = {}) {
  const f = $('#rcf');
  if (!f) return;
  $('#rcLater')?.addEventListener('click', () => {
    $('#rcBox').hidden = true;
    toast('복구 질문은 나중에 쪽지·가족방 화면에서도 만들 수 있어요.');
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#rcErr');
    const show = (t) => {
      err.textContent = t;
      err.hidden = false;
    };
    const qs = [0, 1, 2].map((i) => f[`rq${i}`].value.trim());
    const as = [0, 1, 2].map((i) => f[`ra${i}`].value);
    if (qs.some((q) => !q)) return show('질문 세 개를 모두 적어 주세요.');
    if (as.some((a) => C.normAnswer(a).length < 2)) return show('답은 모두 두 글자 이상으로 정해 주세요.');
    const weak = as.map((a) => C.answerWarning(a)).find(Boolean);
    if (weak && !confirm(`${weak}\n그래도 이 답으로 저장할까요?`)) return;
    err.hidden = true;
    busy('저장하는 중…');
    try {
      const salt = C.b64u.enc(C.rand(16));
      const { proof } = await C.quizKeys(as, salt);
      await api.recovery(target.id, {
        access: target.access,
        token: target.token,
        salt,
        verifier: proof,
        ct: await C.seal(target.content, { q: qs }),
      });
      const box = f.closest('.recovery');
      box.outerHTML = `<div class="recovery saved"><p class="rc-title">✅ 복구 질문을 저장했어요</p>
        <p class="hint">세 답을 꼭 기억해 두세요. 다시 보여 드릴 수 없어요.</p></div>`;
      onSaved?.();
    } catch {
      show('저장하지 못했어요. 인터넷이 되는 곳에서 다시 시도해 주세요.');
    } finally {
      busy();
    }
  });
}

// ---------- 되찾기 (다른 기기) ----------

// rows: 서버가 준 복구 질문 [{ slot, role, salt, ct }] 중 이 기기가 아닌 것
export async function recoverBlock(ctx, nameOf) {
  const rows = [];
  for (const r of ctx.data.recovery || []) {
    if (r.slot === ctx.saved?.slot && (ctx.saved?.role === 'owner' || ctx.saved?.role === 'admin')) continue;
    const body = await C.open(ctx.keys.content, r.ct);
    if (body?.q?.length === 3) rows.push({ ...r, q: body.q });
  }
  if (!rows.length) return { html: '', rows };
  const title = ctx.type === 'note' ? '보낸 사람인데 폰을 바꿨나요?' : '그룹장인데 폰을 바꿨나요?';
  return {
    rows,
    html: `
    <details>
      <summary>${title}</summary>
      <form id="recf" novalidate>
        ${kbdLink()}
        ${
          rows.length > 1
            ? `<label>나는 누구인가요? <select name="who">${rows
                .map((r, i) => `<option value="${i}">${esc(nameOf(r.slot))}</option>`)
                .join('')}</select></label>`
            : `<p class="hint">${esc(nameOf(rows[0].slot))}님이 만든 질문이에요. 세 답을 모두 맞히면 이 기기가 ${
                rows[0].role === 'owner' ? '보낸 사람' : '그룹장'
              } 기기가 되고, 이전 폰의 권한은 끊겨요.</p>`
        }
        <div id="recQs">${qaFields('x', rows[0].q)}</div>
        <p class="error" id="recErr" hidden></p>
        <button class="btn" type="submit">되찾기</button>
      </form>
    </details>`,
  };
}

export function wireRecover(ctx, rows, { title, onDone }) {
  const f = $('#recf');
  if (!f) return;
  const pick = () => rows[f.who ? +f.who.value : 0];
  f.who?.addEventListener('change', () => ($('#recQs').innerHTML = qaFields('x', pick().q)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#recErr');
    const show = (t) => {
      err.textContent = t;
      err.hidden = false;
    };
    const row = pick();
    const as = [0, 1, 2].map((i) => f[`xa${i}`].value);
    if (as.some((a) => !a.trim())) return show('세 답을 모두 적어 주세요.');
    err.hidden = true;
    busy('확인 중…');
    try {
      const { proof } = await C.quizKeys(as, row.salt);
      const nonce = await C.proofOfWork(ctx.id, proof);
      const token = C.newToken();
      const body = { access: ctx.keys.access, slot: row.slot, proof, nonce, tokenHash: await C.sha256hex(token) };
      let res;
      try {
        res = await api.recover(ctx.id, body);
      } catch (e) {
        if (!(e instanceof ApiError && e.body.error === 'human')) throw e;
        busy('확인 중… 틀린 시도가 많아 사람인지 확인해요');
        res = await api.recover(ctx.id, { ...body, human: await humanToken('recover') });
      }
      device.put(ctx.id, { type: ctx.type, r: ctx.rB64, token, slot: res.slot, role: res.role, title });
      session.put(ctx.id, { r: ctx.rB64, type: ctx.type, remember: false });
      render(`
        <section class="paper done">
          <h1>${res.role === 'admin' ? '이제 이 기기가 그룹장이에요' : '보낸 사람 기기로 되찾았어요'}</h1>
          <p>잃어버린 폰의 권한은 끊었어요. 복구 질문은 그대로 쓸 수 있어요.</p>
          <button class="btn primary big" id="go">계속</button>
        </section>`);
      $('#go').addEventListener('click', onDone);
    } catch (e) {
      const code = e instanceof ApiError ? e.body.error : null;
      show(
        code === 'wrong'
          ? `맞지 않는 답이 있어요.${e.body.remaining <= 5 ? ` 오늘 이 인터넷 연결에서 남은 기회: ${e.body.remaining}번` : ''}`
          : code === 'limit'
            ? '오늘은 이 인터넷 연결에서 더 시도할 수 없어요. 내일 다시 시도해 주세요.'
            : code === 'human' || e?.message === 'human' || e?.message === 'human_load'
              ? '사람인지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
              : '연결이 불안정해요. 인터넷이 되는 곳에서 다시 시도해 주세요.'
      );
    } finally {
      busy();
    }
  });
}
