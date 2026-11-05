-- 복구 코드 → "나만 아는 질문 3개"
-- 보낸 사람·그룹장이 폰을 잃어버리면, 쪽지(가족방)를 연 뒤 세 답을 모두 맞혀 권한을 되찾는다.
-- 질문(ct)은 방 열쇠로 암호화되어 방을 연 사람만 볼 수 있고, 서버는 답의 검증값만 가진다.
CREATE TABLE recovery (
  box_id     TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  salt       TEXT NOT NULL,
  verifier   TEXT NOT NULL,
  ct         TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (box_id, slot)
);

DELETE FROM tokens WHERE role = 'recovery';
