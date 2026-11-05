// 링크 미리보기 그림(카카오톡·페이스북·X): public/og.png (1200×630)
// 쓰는 법: node scripts/og-image.mjs  → 그린 뒤 public/og.png 를 바꾼다. 글을 바꾸면 다시 돌린다.
// 카톡은 미리보기를 오래 기억하니, 바꾼 뒤엔 카카오 공유 디버거(developers.kakao.com/tool/debugger/sharing)에서 캐시를 지운다.
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL('../public/og.png', import.meta.url).pathname;

const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    background: #f3eee4; color: #221f1b; word-break: keep-all;
    font-family: "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  }
  .serif { font-family: "AppleMyungjo", "Noto Serif KR", serif; }
  .left { position: absolute; left: 84px; top: 74px; width: 660px; }
  h1 { font: 700 74px/1.3 "AppleMyungjo", "Noto Serif KR", serif; letter-spacing: -.02em; }
  .sub { margin-top: 26px; font-size: 31px; line-height: 1.5; color: #4a443a; font-weight: 500; }
  .sub b { color: #26437c; }
  .brand { position: absolute; left: 84px; bottom: 58px; display: flex; align-items: center; gap: 16px; }
  .env { position: relative; width: 46px; height: 33px; border: 3.5px solid #221f1b; border-radius: 5px; overflow: hidden; }
  .env::before, .env::after { content: ""; position: absolute; top: -2px; width: 30px; height: 3.5px; background: #221f1b; }
  .env::before { left: -3px; transform-origin: 0 0; transform: rotate(37deg); }
  .env::after { right: -3px; transform-origin: 100% 0; transform: rotate(-37deg); }
  .dot { position: absolute; left: 50%; top: 17px; width: 9px; height: 9px; margin-left: -4.5px; border-radius: 50%; background: #b03a2b; }
  .name { font: 700 38px/1 "AppleMyungjo", serif; letter-spacing: .02em; }
  .url { font-size: 29px; font-weight: 700; color: #26437c; margin-left: 10px; letter-spacing: .01em; }

  /* 오른쪽: 문틈에 끼워 둔 약속 장소 쪽지 한 장 */
  .card {
    position: absolute; left: 768px; top: 128px; width: 372px; padding: 40px 32px 34px;
    background: #fffcf5; border: 1px solid #ddd4c3; border-radius: 4px; transform: rotate(2.4deg);
    box-shadow: 0 2px 2px rgba(70, 50, 20, .06), 0 26px 40px -18px rgba(70, 50, 20, .38);
  }
  .tape { position: absolute; top: -15px; left: 50%; width: 120px; height: 32px; margin-left: -60px; background: rgba(214, 196, 150, .8); transform: rotate(-3deg); }
  .label { display: flex; align-items: center; gap: 12px; color: #26437c; font-size: 24px; font-weight: 800; }
  .pin { width: 20px; height: 20px; border-radius: 50% 50% 50% 0; box-shadow: inset 0 0 0 6px #26437c; transform: rotate(-45deg); }
  .place { margin-top: 14px; font: 700 32px/1.35 "AppleMyungjo", serif; white-space: nowrap; }
  .body {
    margin-top: 18px; font: 26px/1.9 "AppleMyungjo", serif;
    background: repeating-linear-gradient(transparent 0 calc(1.9em - 1.5px), rgba(38, 67, 124, .16) 0 1.9em);
  }
  .sig { margin-top: 10px; text-align: right; font: 24px/1 "AppleMyungjo", serif; color: #625b4f; }
  .stamp {
    position: absolute; left: -40px; bottom: -44px; width: 112px; height: 112px; display: grid; place-content: center;
    border: 3.5px solid #b03a2b; border-radius: 50%; color: #b03a2b; transform: rotate(-12deg); text-align: center;
    font: 700 31px/1.05 "AppleMyungjo", serif; letter-spacing: .06em; background: rgba(255, 252, 245, .55);
  }
  .stamp::before { content: ""; position: absolute; inset: 6px; border: 1.5px solid #b03a2b; border-radius: 50%; }
  .stamp small { display: block; margin-top: 6px; font-size: 15px; letter-spacing: .04em; }
</style>
<body>
  <div class="left">
    <h1>전쟁이 나면,<br>우리 가족은<br>어디서 만나죠?</h1>
    <p class="sub">약속 장소를 미리 정해 두세요. <b>3분</b>이면 돼요.<br>전화와 메신저가 끊겨도 쪽지는 남습니다.</p>
  </div>
  <div class="brand"><span class="env"><i class="dot"></i></span><span class="name">오작교</span><span class="url">findmeinkorea.com</span></div>
  <div class="card">
    <span class="tape"></span>
    <p class="label"><i class="pin"></i>약속 장소</p>
    <p class="place">할머니 댁 앞 놀이터</p>
    <p class="body">연락이 끊기면 매일 오후&nbsp;3시, 여기서 기다릴게.</p>
    <p class="sig">— 엄마</p>
    <p class="stamp">남김<small>오작교</small></p>
  </div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
console.log(`그렸어요: ${OUT}`);
