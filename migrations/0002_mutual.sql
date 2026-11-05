-- 맞쪽지: 상대도 나에게 쪽지를 써야 나타나는 쪽지
-- want = "상대 → 나" 이름끼리 출입문 ID. 그 출입문을 가진 쪽지가 생기면 숨김이 풀린다.
ALTER TABLE boxes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boxes ADD COLUMN want TEXT;
CREATE INDEX boxes_want ON boxes(want) WHERE hidden = 1;

-- 숨어 있어도 보이는 출입문 (보낸 사람이 자기 쪽지 상태를 확인하는 "내가 보낸 쪽지" 문)
ALTER TABLE doors ADD COLUMN always INTEGER NOT NULL DEFAULT 0;
