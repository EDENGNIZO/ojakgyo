// 서버와 주고받는 부분, 그리고 이 기기에 저장하는 부분

import { humanToken } from './human.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

// quiet: 뒤에서 조용히 보내는 요청. 요청이 몰려도(503 busy) 사람 확인 창을 띄우지 않고 그냥 실패한다
async function call(path, body, { retried = false, quiet = false } = {}) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    // 요청이 몰리면 서버는 사람 확인을 거친 요청만 받는다(503 busy). 확인을 거쳐 한 번만 다시 보낸다
    if (res.status === 503 && data?.error === 'busy' && body !== undefined && !retried && !quiet) {
      let human;
      try {
        human = await humanToken('busy');
      } catch {
        throw new ApiError(res.status, data);
      }
      return call(path, { ...body, human }, { retried: true });
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  stats: () => call('/api/stats'),
  // 홈 화면의 새 소식 뱃지: [{ id, access, token }] → 남이 남긴 마지막 글·접속 시각
  peek: (boxes) => call('/api/peek', { boxes }, { quiet: true }),
  // 접속 신호(기기마다 하루 한 번, 어드민 통계용)와 어드민 통계
  hello: (body) => call('/api/hello', body, { quiet: true }),
  admin: (key) => call('/api/admin', { key }),
  find: (doors, human) => call('/api/find', { doors, human }),
  create: (payload) => call('/api/box', payload),
  unlock: (box, proof, nonce, human) => call('/api/unlock', { box, proof, nonce, human }),
  read: (id, body) => call(`/api/box/${id}/read`, body),
  post: (id, body) => call(`/api/box/${id}/post`, body),
  device: (id, body) => call(`/api/box/${id}/device`, body),
  invite: (id, body) => call(`/api/box/${id}/invite`, body),
  claim: (id, body) => call(`/api/box/${id}/claim`, body),
  recovery: (id, body) => call(`/api/box/${id}/recovery`, body),
  recover: (id, body) => call(`/api/box/${id}/recover`, body),
  release: (id, body) => call(`/api/box/${id}/release`, body),
  close: (id, body) => call(`/api/box/${id}/close`, body),
  withdraw: (id, body) => call(`/api/box/${id}/withdraw`, body),
  geocode: (q) => call('/api/geocode', { q }),
  doors: (id, body) => call(`/api/box/${id}/doors`, body),
};

// ---------- 이 기기에 저장 ----------
// "이 기기 기억하기"를 고른 쪽지·가족방만 저장한다. 인터넷이 끊겨도 마지막으로 본 내용을 볼 수 있게.

const KEY = 'findme.v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { boxes: {} };
  } catch {
    return { boxes: {} };
  }
}
function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export const device = {
  list() {
    return Object.entries(load().boxes)
      .map(([id, b]) => ({ id, ...b }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },
  get(id) {
    return load().boxes[id] || null;
  },
  put(id, patch) {
    const s = load();
    s.boxes[id] = { ...(s.boxes[id] || {}), ...patch, savedAt: Date.now() };
    save(s);
  },
  // 정렬 기준(savedAt)은 건드리지 않고 표시용 값만 고친다 (새 소식 뱃지)
  mark(id, patch) {
    const s = load();
    if (!s.boxes[id]) return;
    s.boxes[id] = { ...s.boxes[id], ...patch };
    save(s);
  },
  remove(id) {
    const s = load();
    delete s.boxes[id];
    save(s);
    try {
      sessionStorage.removeItem(`findme.s.${id}`);
    } catch {}
  },
  // 찾기 결과에서 숨긴 쪽지. 이 기기에서만 숨기고 서버나 다른 사람에게는 아무 영향이 없다
  hidden() {
    return new Set(load().hidden || []);
  },
  setHidden(id, on) {
    const s = load();
    const set = new Set(s.hidden || []);
    if (on) set.add(id);
    else set.delete(id);
    s.hidden = [...set];
    save(s);
  },
  // 빌린 기기에서 쓴 흔적을 모두 지운다 (저장된 쪽지·가족방, 찾은 결과, 열어 둔 열쇠)
  clearAll() {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.clear();
    } catch {}
  },
};

// 기억하지 않은 방의 열쇠는 이 탭이 열려 있는 동안만 보관
export const session = {
  get(id) {
    try {
      return JSON.parse(sessionStorage.getItem(`findme.s.${id}`));
    } catch {
      return null;
    }
  },
  put(id, value) {
    try {
      sessionStorage.setItem(`findme.s.${id}`, JSON.stringify(value));
    } catch {}
  },
};
