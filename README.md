# 오작교

전쟁이나 재난으로 전화와 메신저가 끊겨도, 소중한 사람에게 쪽지와 만날 곳을 남겨 두는 웹사이트입니다.

**https://findmeinkorea.com**

이 저장소는 실제로 배포되는 코드를 그대로 공개합니다.
"서버는 쪽지를 읽을 수 없다"는 말이 사실인지 누구나 직접 확인할 수 있게 하려는 것입니다.

## 어디를 보면 되나요

| 확인하고 싶은 것 | 파일 |
| --- | --- |
| 쪽지가 기기 안에서 잠기는 과정 (AES-256-GCM, PBKDF2-SHA-256 20만 번) | `public/js/crypto.js` |
| 서버가 받는 값과 저장하는 값 | `src/worker.js`, `migrations/` |
| 서버 비밀 열쇠로 답 확인값을 한 번 더 잠그는 부분 | `src/pepper.js` |
| 답 맞혀 보기 횟수 제한·작업 증명 | `src/worker.js`의 `LIMITS`, `public/js/human.js` |
| 화면 | `public/js/*.js`, `public/style.css` |

## 서버에 남는 것

- 이름·생일·전화번호의 원래 값은 받지 않습니다. 기기에서 한 방향으로 계산한 값만 받습니다.
- 질문, 답, 메시지, 약속 장소는 암호문으로만 받습니다. 답과 답에서 만든 열쇠는 아예 보내지 않습니다.
- IP 주소는 저장하지 않습니다. 반복 시도를 세는 데 날마다 바뀌는 해시값을 하루 동안만 씁니다.
- 접속 통계는 날짜별 숫자(접속 수, 국가, 유입 경로)로만 더합니다.

자세한 설명은 사이트의 [쪽지는 어떻게 지켜지나요?](https://findmeinkorea.com/#/about)에 있습니다.

## 구성

- Cloudflare Workers + D1. 프레임워크와 외부 CDN 없이 순수 HTML·CSS·JavaScript로 만들었습니다.
- 느린 인터넷을 생각해 화면은 가볍게 두고, 지도(Leaflet, `public/vendor/leaflet`)는 누를 때만 불러옵니다. 바깥에서 받는 것은 OpenStreetMap 지도 타일뿐입니다.

## 로컬에서 실행

```bash
npm install
npm run db:local
npm run dev
```

http://localhost:8787 에서 열립니다. 루트에 `.dev.vars` 파일을 만들고 로컬용 값을 넣어 주세요.

```
PEPPER=아무_긴_무작위_문자열
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
ADMIN_KEY=아무_긴_무작위_문자열
```

`TURNSTILE_SECRET`의 값은 Cloudflare가 공개한 시험용 키(항상 통과)입니다. `KAKAO_REST_KEY`가 없으면 주소 검색은 OpenStreetMap으로 넘어갑니다.

시나리오 테스트는 로컬 서버를 켠 채로 돌립니다.

```bash
node scripts/simulate.mjs
```

## 제보

- 오류나 문의는 [이슈](../../issues)로 남겨 주세요.
- 보안 허점은 공개 이슈 대신 Security 탭의 **Report a vulnerability**로 비공개로 알려 주세요.

## 저작권

코드는 확인할 수 있도록 공개한 것이며, 따로 라이선스를 붙이지 않았습니다. 모든 권리는 만든 사람에게 있습니다.
`public/vendor/leaflet`은 Leaflet의 라이선스(BSD-2-Clause)를 따릅니다.
