// 낮·밤 화면: 처음 오면 낮(밝은 화면)으로 연다. 오른쪽 위 버튼으로 밤을 고르면 그 선택만 기억한다.
// 그리기 전에 적용해야 깜빡이지 않아서 모듈이 아닌 일반 스크립트로 <head>에서 읽는다.
(() => {
  const KEY = 'findme.theme';
  const COLOR = { light: '#f3eee4', dark: '#181715' };
  const root = document.documentElement;
  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  function apply(theme) {
    root.dataset.theme = theme;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = COLOR[theme];
    const btn = document.getElementById('theme');
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기');
  }

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  apply(saved === 'dark' ? 'dark' : 'light');

  addEventListener('DOMContentLoaded', () => {
    apply(current());
    document.getElementById('theme').addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        if (next === 'dark') localStorage.setItem(KEY, 'dark');
        else localStorage.removeItem(KEY);
      } catch {}
    });
  });
})();
