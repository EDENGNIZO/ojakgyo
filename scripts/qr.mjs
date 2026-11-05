// 후원 QR(정적 SVG) 만들기. 링크가 바뀌면 다시 돌린다.
// 사용: node scripts/qr.mjs 'https://qr.kakaopay.com/…' public/qr-kakaopay.svg
import QRCode from 'qrcode';
import { writeFile } from 'node:fs/promises';

const [url, out = 'public/qr-kakaopay.svg'] = process.argv.slice(2);
if (!url) {
  console.error("사용: node scripts/qr.mjs '링크' [출력 파일]");
  process.exit(1);
}
// 미색 종이 위 먹색. 어두운 화면에서도 우표처럼 밝은 바탕을 유지해야 카메라가 읽는다
const svg = await QRCode.toString(url, {
  type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#221f1bff', light: '#fffcf5ff' },
});
await writeFile(out, svg);
console.log(`${out} (${svg.length} bytes)`);
