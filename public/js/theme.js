// 낮·밤 화면: 기본은 폰 설정을 따르고, 오른쪽 위 버튼으로 바꾼 것만 기억한다.
// 그리기 전에 적용해야 깜빡이지 않아서 모듈이 아닌 일반 스크립트로 <head>에서 읽는다.
(() => {
  const KEY = 'findme.theme';
  const COLOR = { light: '#f3eee4', dark: '#181715' };
  const root = document.documentElement;
  const sys = matchMedia('(prefers-color-scheme: dark)');
  const sysTheme = () => (sys.matches ? 'dark' : 'light');
  const current = () => root.dataset.theme || sysTheme();

  function apply(theme) {
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      m.content = COLOR[theme || (m.media.includes('dark') ? 'dark' : 'light')];
    }
    const btn = document.getElementById('theme');
    if (btn) btn.setAttribute('aria-label', current() === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기');
  }

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  apply(saved === 'light' || saved === 'dark' ? saved : null);

  addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.getElementById('theme').addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      // 폰 설정과 같아지면 기억을 지워서 다시 폰 설정을 따른다
      const keep = next !== sysTheme() ? next : null;
      apply(keep);
      try {
        if (keep) localStorage.setItem(KEY, keep);
        else localStorage.removeItem(KEY);
      } catch {}
    });
  });
  sys.addEventListener('change', () => apply(root.dataset.theme));
})();
