// 사람인지 확인 (Cloudflare Turnstile). 쪽지·가족방을 만들 때, 같은 IP에서 찾기·답 시도가 많을 때,
// 그리고 서버에 요청이 몰릴 때(busy, api.js) 쓴다.
// 대부분은 클릭 없이 지나가고, 의심스러울 때만 확인 칸이 진행 표시 안에 나타난다.

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
// 로컬에서는 Cloudflare가 공개한 시험용 키(항상 통과)를 쓴다.
const SITEKEY = LOCAL ? '1x00000000000000000000AA' : '0x4AAAAAAFwrLCvRVxbsbfUY';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading = null;

export function preloadHuman() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('human_load'));
    };
    document.head.append(s);
  });
  return loading;
}

export async function humanToken(action) {
  const ts = await preloadHuman();
  const box = document.getElementById('human');
  box.hidden = false;
  let id;
  try {
    return await new Promise((resolve, reject) => {
      id = ts.render(box, {
        sitekey: SITEKEY,
        action,
        appearance: 'interaction-only',
        language: 'ko',
        callback: resolve,
        'before-interactive-callback': () => {
          document.getElementById('busy-text').textContent = '아래 칸을 눌러 주세요';
        },
        'error-callback': () => reject(new Error('human')),
        'timeout-callback': () => reject(new Error('human')),
      });
    });
  } finally {
    if (id !== undefined) ts.remove(id);
    box.hidden = true;
  }
}
