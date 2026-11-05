-- 접속 통계: 날짜별 숫자만 모은다. 누가 언제 왔는지는 남기지 않는다 (어드민 페이지 #/admin).
-- k: uv(접속 기기 수) · new(처음 온 기기) · c:국가코드 · r:유입 경로 · e:처음 연 화면
CREATE TABLE stats (
  day TEXT NOT NULL,
  k   TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, k)
);
-- 어드민 통계의 날짜별 글 수 집계용
CREATE INDEX entries_created ON entries(created_at);
