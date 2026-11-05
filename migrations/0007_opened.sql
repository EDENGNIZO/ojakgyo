-- 쪽지가 열렸는지: 0 아직 아무도 답을 맞히지 않음, 1 누군가 답을 맞혀 열었음, 2 이 기능 전에 만든 쪽지(열렸는지 모름)
-- 보낸 사람은 0일 때만 쪽지를 거둘 수 있다. 예전 쪽지는 받는 사람이 이미 열어 저장했을 수 있으니 2로 두어 거둘 수 없게 한다.
-- 시각은 남기지 않는다(열렸다는 사실 한 칸만).
ALTER TABLE boxes ADD COLUMN opened INTEGER NOT NULL DEFAULT 0;
UPDATE boxes SET opened = 2;
