// 배포용 빌드: public/ 을 dist/ 로 복사하면서 JS·CSS를 압축(minify)한다. 원본(public/)은 주석까지 그대로 둔다.
// 파일을 하나로 묶지는 않는다. 화면별로 나눠 받는 구조(첫 화면을 가볍게)와 서비스 워커의 파일 목록을 그대로 쓰기 위해서.
// 사용: node scripts/build.mjs   (npm run deploy 가 먼저 실행한다)

import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { transform } from 'esbuild';

const SRC = new URL('../public/', import.meta.url).pathname;
const OUT = new URL('../dist/', import.meta.url).pathname;

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'vendor') yield* files(p); // 지도 프로그램은 이미 압축돼 있다
    } else if (/\.(js|css)$/.test(name)) yield p;
  }
}

let before = 0;
let after = 0;
for (const p of files(OUT)) {
  const code = await readFile(p, 'utf8');
  const out = await transform(code, { loader: p.endsWith('.css') ? 'css' : 'js', minify: true, legalComments: 'none', charset: 'utf8' });
  await writeFile(p, out.code);
  before += Buffer.byteLength(code);
  after += Buffer.byteLength(out.code);
}
console.log(`dist/ 완성: JS·CSS ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB (압축 전 크기)`);
