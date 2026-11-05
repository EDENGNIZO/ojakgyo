-- 받는 사람이 지운 쪽지: 출입문은 모두 떼고, 언제 지웠는지만 남긴다 (보낸 사람 기기에 "받는 사람이 지웠어요")
ALTER TABLE boxes ADD COLUMN closed_at INTEGER;
