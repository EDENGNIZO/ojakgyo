// 운영 통계 (#/admin). 관리 열쇠(서버의 ADMIN_KEY)가 맞을 때만 서버가 집계 숫자를 준다.
// 접속은 기기마다 하루 한 번 보내는 신호를 센 것(app.js hello). 개인 기록은 없고 날짜별 숫자뿐이다.
import { api, ApiError } from './api.js';
import { $, esc, render, busy } from './ui.js';

const KEY = 'findme.admin'; // 열쇠는 이 탭을 닫을 때까지만 (sessionStorage)

const COUNTRY = {
  KR: '한국', US: '미국', JP: '일본', CN: '중국', VN: '베트남', PH: '필리핀', TH: '태국', ID: '인도네시아', CA: '캐나다',
  AU: '호주', GB: '영국', DE: '독일', FR: '프랑스', RU: '러시아', TW: '대만', HK: '홍콩', SG: '싱가포르', MY: '말레이시아',
  IN: '인도', BR: '브라질', MX: '멕시코', NZ: '뉴질랜드', UZ: '우즈베키스탄', KZ: '카자흐스탄', MN: '몽골', NL: '네덜란드',
  SE: '스웨덴', IT: '이탈리아', ES: '스페인', KP: '북한', IR: '이란', T1: 'Tor', XX: '알 수 없음',
};
const REF = {
  direct: '직접 입력·메신저', kakao: '카카오', naver: '네이버', daum: '다음', google: '구글', instagram: '인스타그램',
  facebook: '페이스북', x: 'X(트위터)', telegram: '텔레그램', youtube: '유튜브', other: '그 밖의 사이트',
};
const ROUTE = {
  home: '첫 화면', find: '쪽지 확인', results: '찾은 결과', write: '쪽지 남기기', room: '가족방 만들기',
  box: '쪽지·가족방 보기', unlock: '질문 답하기', about: '안내', other: '그 밖',
};

const fmt = (n) => (n || 0).toLocaleString();
const kstDay = (ts) => new Date(ts + 9 * 3600_000).toISOString().slice(0, 10);

export async function adminView() {
  let key = null;
  try {
    key = sessionStorage.getItem(KEY);
  } catch {}
  if (!key) return keyForm();
  busy('불러오는 중…');
  try {
    await show(key);
  } catch (e) {
    keyForm(message(e));
  } finally {
    busy();
  }
}

// 미끼(#/admin): 진짜와 똑같이 생겼지만 어떤 열쇠도 맞지 않고, 서버에는 시도 횟수만 남긴다(통계의 "가짜 관리 페이지 시도")
export function decoyView() {
  keyForm(undefined, true);
}

function message(e) {
  const code = e instanceof ApiError ? e.body.error : null;
  if (code === 'denied') return '열쇠가 맞지 않아요.';
  if (code === 'limit') return '오늘은 더 시도할 수 없어요. 내일 다시 해 주세요.';
  if (code === 'not_found') return '이 서버에는 관리 열쇠가 설정돼 있지 않아요.';
  return '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

function keyForm(error, decoy = false) {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  render(`
    <section class="paper">
      <h1>운영 통계</h1>
      <form id="akey">
        <label>관리 열쇠 <input name="key" type="password" autocomplete="off" required></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="btn primary">보기</button>
      </form>
      <p class="fine">열쇠는 이 탭을 닫을 때까지만 기억해요. 틀리면 하루 10번까지만 다시 시도할 수 있어요.</p>
    </section>`);
  $('#akey').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = e.target.key.value.trim();
    busy('불러오는 중…');
    try {
      if (decoy) {
        // 진짜 서버 확인은 하지 않는다. 시도 횟수만 세고 늘 틀렸다고 한다
        await Promise.all([api.hello({ decoy: true }).catch(() => {}), new Promise((r) => setTimeout(r, 700))]);
        return keyForm('열쇠가 맞지 않아요.', true);
      }
      await show(key);
      try {
        sessionStorage.setItem(KEY, key);
      } catch {}
    } catch (err) {
      keyForm(message(err));
    } finally {
      busy();
    }
  });
}

// ---------- 그래프 (SVG, 라이브러리 없이) ----------

const niceMax = (m) => {
  const p = 10 ** Math.floor(Math.log10(m));
  const u = m / p;
  return (u <= 1 ? 1 : u <= 2 ? 2 : u <= 5 ? 5 : 10) * p;
};

// rows: [{ x, y(접속), y2(처음 온 기기) }]
function barChart(rows, fmtX, labelEvery, title) {
  const W = 640, H = 220, L = 44, R = 8, T = 14, B = 26;
  const top = niceMax(Math.max(1, ...rows.map((r) => r.y)));
  const ih = H - T - B;
  const bw = (W - L - R) / rows.length;
  const y = (v) => T + ih - (v / top) * ih;
  const grid = [0, 0.5, 1]
    .map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" class="c-grid"/>
      <text x="${L - 6}" y="${y(top * f) + 4}" class="c-y">${fmt(Math.round(top * f))}</text>`)
    .join('');
  const bars = rows
    .map((r, i) => {
      const x = L + i * bw + bw * 0.18;
      const w = bw * 0.64;
      return `<g><title>${esc(fmtX(r.x, true))}: 접속 ${fmt(r.y)} · 처음 ${fmt(r.y2)}</title>
        <rect x="${x}" y="${y(r.y)}" width="${w}" height="${ih - (y(r.y) - T)}" class="c-bar"/>
        ${r.y2 ? `<rect x="${x}" y="${y(r.y2)}" width="${w}" height="${ih - (y(r.y2) - T)}" class="c-new"/>` : ''}
      </g>`;
    })
    .join('');
  const labels = rows
    .map((r, i) =>
      i % labelEvery === 0 || i === rows.length - 1
        ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" class="c-x">${esc(fmtX(r.x))}</text>`
        : ''
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}${labels}</svg>`;
}

// 이번 달까지 12달 (YYYY-MM)
function lastMonths(n) {
  const now = new Date(Date.now() + 9 * 3600_000);
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7)
  );
}

async function show(key) {
  const d = await api.admin(key);
  const days = Array.from({ length: d.days }, (_, i) => kstDay(Date.now() - (d.days - 1 - i) * 86400_000));
  // 날짜별 표: by[day][k] = n
  const by = {};
  for (const r of d.stats) (by[r.day] ||= {})[r.k] = r.n;
  for (const r of d.boxes.daily) (by[r.day] ||= {})[`b:${r.type}`] = r.n;
  for (const r of d.entries.daily) (by[r.day] ||= {}).posts = r.n;
  const at = (day, k) => by[day]?.[k] || 0;
  const sum = (k, from = 0) => days.slice(from).reduce((s, day) => s + at(day, k), 0);
  const today = days.at(-1);
  const yesterday = days.at(-2);
  const totalOf = (type) => d.boxes.total.find((r) => r.type === type)?.n || 0;
  // 접두어별 합계 (국가·유입 경로·첫 화면)
  const ranked = (prefix) => {
    const acc = {};
    for (const r of d.stats) if (r.k.startsWith(prefix)) acc[r.k.slice(prefix.length)] = (acc[r.k.slice(prefix.length)] || 0) + r.n;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  };
  const bars = (rows, label) => {
    const total = rows.reduce((s, [, n]) => s + n, 0) || 1;
    const top = rows[0]?.[1] || 1;
    return rows.length
      ? `<ul class="bars">${rows
          .slice(0, 12)
          .map(
            ([k, n]) => `<li><span>${esc(label(k))}</span><b>${fmt(n)} <small>${Math.round((n / total) * 100)}%</small></b>
              <i style="width:${Math.max(2, Math.round((n / top) * 100))}%"></i></li>`
          )
          .join('')}</ul>`
      : '<p class="fine">아직 기록이 없어요.</p>';
  };
  const tile = (label, n, sub = '') => `<div><dt>${label}</dt><dd>${fmt(n)}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  // 그래프: 일별(최근 30일)·월별(12달)
  const dailyRows = days.map((day) => ({ x: day, y: at(day, 'uv'), y2: at(day, 'new') }));
  const byM = {};
  for (const r of d.months || []) (byM[r.m] ||= {})[r.k] = r.n;
  const monthRows = lastMonths(12).map((m) => ({ x: m, y: byM[m]?.uv || 0, y2: byM[m]?.new || 0 }));
  const fmtDay = (x, long) => (long ? x : x.slice(5));
  const fmtMonth = (x, long) => (long ? `${x.slice(0, 4)}년 ${+x.slice(5)}월` : `${x.slice(2, 4)}.${x.slice(5)}`);

  render(`
    <section class="paper">
      <p class="kicker">운영 통계 · 최근 ${d.days}일 · 한국 시간 ${esc(today)}</p>
      <h1>오작교 지금</h1>
      <dl class="tiles">
        ${tile('오늘 접속 기기', at(today, 'uv'), `어제 ${fmt(at(yesterday, 'uv'))}`)}
        ${tile('7일 접속', sum('uv', d.days - 7), `${d.days}일 ${fmt(sum('uv'))}`)}
        ${tile('처음 온 기기(누적)', d.newTotal, `오늘 ${fmt(at(today, 'new'))}`)}
        ${tile('기억된 기기', d.devices, '열쇠를 저장한 기기')}
        ${tile('쪽지(누적)', totalOf('note'), `오늘 ${fmt(at(today, 'b:note'))}`)}
        ${tile('가족방(누적)', totalOf('room'), `오늘 ${fmt(at(today, 'b:room'))}`)}
        ${tile('남긴 글(누적)', d.entries.total, `오늘 ${fmt(at(today, 'posts'))}`)}
        ${tile('가짜 관리 페이지 시도', sum('decoy'), `오늘 ${fmt(at(today, 'decoy'))} · 30일 합계`)}
      </dl>
    </section>
    <section class="paper">
      <div class="row2 tight">
        <h2>접속 그래프</h2>
        <div class="seg" role="group" aria-label="기간">
          <button type="button" class="btn small" data-chart="daily" aria-pressed="true">일별</button>
          <button type="button" class="btn small" data-chart="monthly" aria-pressed="false">월별</button>
        </div>
      </div>
      <div id="chart-daily">${barChart(dailyRows, fmtDay, 5, '최근 30일 일별 접속')}</div>
      <div id="chart-monthly" hidden>
        ${barChart(monthRows, fmtMonth, 1, '최근 12달 월별 접속')}
        <div class="scroll-x"><table class="stat">
          <thead><tr><th>달</th><th>접속</th><th>처음 온 기기</th></tr></thead>
          <tbody>${[...monthRows].reverse().map((r) => `<tr><td>${esc(fmtMonth(r.x, true))}</td><td>${fmt(r.y)}</td><td>${fmt(r.y2)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <p class="fine">막대는 접속 기기, 안쪽 짙은 막대는 처음 온 기기예요. 막대에 손가락을 올리거나 길게 누르면 숫자가 보여요.</p>
    </section>
    <section class="paper">
      <h2>접속 위치</h2>
      ${bars(ranked('c:'), (c) => COUNTRY[c] || c)}
    </section>
    <section class="paper">
      <h2>유입 경로</h2>
      ${bars(ranked('r:'), (r) => REF[r] || r)}
      <p class="fine">메신저(카카오톡·문자 등)에서 열면 보내는 곳이 알려지지 않아 "직접 입력·메신저"로 잡혀요.</p>
    </section>
    <section class="paper">
      <h2>처음 연 화면</h2>
      ${bars(ranked('e:'), (r) => ROUTE[r] || r)}
    </section>
    <section class="paper">
      <h2>날짜별</h2>
      <div class="scroll-x">
        <table class="stat">
          <thead><tr><th>날짜</th><th>접속</th><th>처음</th><th>쪽지</th><th>가족방</th><th>글</th></tr></thead>
          <tbody>${[...days]
            .reverse()
            .map(
              (day) => `<tr><td>${esc(day.slice(5))}</td><td>${fmt(at(day, 'uv'))}</td><td>${fmt(at(day, 'new'))}</td>
                <td>${fmt(at(day, 'b:note'))}</td><td>${fmt(at(day, 'b:room'))}</td><td>${fmt(at(day, 'posts'))}</td></tr>`
            )
            .join('')}</tbody>
        </table>
      </div>
      <p class="fine">접속은 기기마다 하루 한 번 보내는 신호를 센 것이라 실제 사람 수와 조금 다를 수 있어요.
        하루 3,000을 넘으면 10개 중 1개만 기록해 10으로 셉니다(추정치). 요청·대역폭 같은 트래픽 자체는 Cloudflare 대시보드 → Analytics에서 보세요.</p>
      <div class="row2 tight"><a class="btn small ghost" href="#/">처음으로</a><button type="button" class="btn small ghost" id="alogout">열쇠 지우기</button></div>
    </section>`);
  $('#alogout').addEventListener('click', () => keyForm());
  for (const b of document.querySelectorAll('[data-chart]')) {
    b.addEventListener('click', () => {
      for (const o of document.querySelectorAll('[data-chart]')) o.setAttribute('aria-pressed', String(o === b));
      $('#chart-daily').hidden = b.dataset.chart !== 'daily';
      $('#chart-monthly').hidden = b.dataset.chart !== 'monthly';
    });
  }
}
