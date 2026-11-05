-- 서버는 이름·생일·내용을 모른다. 모든 값은 브라우저에서 만든 해시나 암호문이다.

-- 쪽지(note) 또는 가족방(room) 하나
CREATE TABLE boxes (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('note', 'room')),
  salt         TEXT NOT NULL,              -- 퀴즈 키 유도용 소금 (공개값)
  verifier     TEXT NOT NULL,              -- 퀴즈 정답 검증값
  wrapped      TEXT NOT NULL,              -- 퀴즈 키로 감싼 방 열쇠 (정답일 때만 내려줌)
  access_hash  TEXT NOT NULL,              -- 방 열쇠에서 유도한 출입 토큰의 해시
  fail_count   INTEGER NOT NULL DEFAULT 0,
  last_fail_at INTEGER NOT NULL DEFAULT 0,
  next_try_at  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX boxes_created ON boxes(created_at);

-- 출입문: 받는 사람 정보(이름+생일 등)에서 유도한 색인. 질문은 암호화된 teaser 안에 있다.
CREATE TABLE doors (
  door_id    TEXT NOT NULL,
  box_id     TEXT NOT NULL,
  teaser     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX doors_door ON doors(door_id);
CREATE INDEX doors_box ON doors(box_id);

-- 타임라인 글 (헤더 포함). badge는 서버가 토큰으로 판단해 붙인다.
CREATE TABLE entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id     TEXT NOT NULL,
  ct         TEXT NOT NULL,
  badge      TEXT NOT NULL CHECK (badge IN ('owner', 'admin', 'device', 'new')),
  slot       INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX entries_box ON entries(box_id, id);

-- 기기 토큰: 쪽지 작성자(owner), 그룹장(admin), 기억된 기기(device),
-- 그룹장 초대 코드(invite), 기기를 잃어버렸을 때 쓰는 복구 코드(recovery)
CREATE TABLE tokens (
  box_id     TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'device', 'invite', 'recovery')),
  slot       INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (box_id, token_hash)
);

-- 구성원(slot)별 마지막 접속
CREATE TABLE seen (
  box_id    TEXT NOT NULL,
  slot      INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (box_id, slot)
);

-- 구성원별 접속 기록. 최근 10회만 남기고 지운다.
CREATE TABLE visits (
  box_id TEXT NOT NULL,
  slot   INTEGER NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX visits_box ON visits(box_id, slot, at);

-- 시도 횟수 제한 카운터 (IP는 날마다 바뀌는 해시로만 저장)
CREATE TABLE counters (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
