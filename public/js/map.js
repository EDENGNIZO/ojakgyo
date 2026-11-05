// 지도는 필요한 화면에서만 불러온다. 지도가 안 떠도 메모와 좌표만으로 찾아갈 수 있게 한다.

// 지도 프로그램은 우리 사이트에 직접 올려 둔다 (외부 CDN이 끊겨도 핀 찍기가 되도록)
const LEAFLET = '/vendor/leaflet/';
const SEOUL = [37.5665, 126.978];
let loading = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET + 'leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET + 'leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => {
      loading = null;
      reject(new Error('map unavailable'));
    };
    document.head.appendChild(js);
  });
  return loading;
}

function tiles(L) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
    // OSM은 어느 사이트가 쓰는지 모르는(Referer 없는) 요청에 "Access blocked" 타일을 보낸다.
    // 문서 전체는 no-referrer지만 타일 요청에만 우리 도메인(경로 없이)을 알려 준다.
    referrerPolicy: 'strict-origin',
  });
}

const pinIcon = (L) =>
  L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 26] });

export const fmtCoord = (p) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

export function mapLinks(p) {
  const label = encodeURIComponent(p.memo || '약속 장소');
  return {
    kakao: `https://map.kakao.com/link/map/${label},${p.lat},${p.lng}`,
    google: `https://www.google.com/maps?q=${p.lat},${p.lng}`,
  };
}

// 장소 고르기. 지도는 무거워서(100~300KB) 누를 때만 연다.
// 지도 없이도 검색 결과나 현재 위치로 핀을 찍을 수 있다.
export function mountPicker(el, initial, onChange) {
  let point = initial ? { lat: initial.lat, lng: initial.lng } : null;
  let map = null;
  let marker = null;
  let L = null;

  // 닫힌 상태에선 버튼 하나만. 옆의 "내 위치로 찍기"와 같은 칸 크기로 놓인다 (write.js의 .row2.pick)
  el.innerHTML = `<button type="button" class="btn small" data-act="openmap">지도에서 직접 찍기</button>`;
  el.classList.add('map-closed');

  const put = (lat, lng) => {
    point = { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
    if (map) {
      if (marker) marker.setLatLng([point.lat, point.lng]);
      else marker = L.marker([point.lat, point.lng], { icon: pinIcon(L) }).addTo(map);
    }
    onChange(point);
  };

  const fallback = () => {
    el.classList.remove('map-closed');
    el.classList.add('map-fallback');
    el.innerHTML = `
      <p class="hint">지도를 불러오지 못했어요. 좌표를 알면 직접 넣고, 아니면 메모만 자세히 적어 주세요.</p>
      <div class="row2">
        <input inputmode="decimal" placeholder="위도 (예: 37.5665)" data-k="lat">
        <input inputmode="decimal" placeholder="경도 (예: 126.9780)" data-k="lng">
      </div>`;
    const read = () => {
      const lat = parseFloat(el.querySelector('[data-k=lat]').value);
      const lng = parseFloat(el.querySelector('[data-k=lng]').value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) put(lat, lng);
      else onChange((point = null));
    };
    el.querySelectorAll('input').forEach((i) => i.addEventListener('input', read));
  };

  const open = async () => {
    el.innerHTML = '<p class="hint">지도를 여는 중…</p>';
    try {
      L = await loadLeaflet();
    } catch {
      return fallback();
    }
    el.innerHTML = '';
    el.classList.remove('map-closed');
    el.classList.add('map');
    map = L.map(el, { zoomControl: true }).setView(point ? [point.lat, point.lng] : SEOUL, point ? 16 : 11);
    tiles(L).addTo(map);
    if (point) put(point.lat, point.lng);
    map.on('click', (e) => put(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map.invalidateSize(), 50);
  };
  el.querySelector('[data-act=openmap]').addEventListener('click', open);

  return {
    // 주소 검색 결과를 고르면 그 자리에 핀을 찍는다
    setPoint(lat, lng) {
      put(lat, lng);
      map?.setView([lat, lng], 17);
    },
    // 지금 있는 곳을 핀으로. 위치는 이 쪽지 안에 암호화되어 들어갈 뿐 따로 보내지 않는다.
    locate() {
      if (!navigator.geolocation) return Promise.reject(new Error('no_geo'));
      return new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            put(pos.coords.latitude, pos.coords.longitude);
            map?.setView([point.lat, point.lng], 16);
            resolve(point);
          },
          reject,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        )
      );
    },
  };
}

// 장소 보여주기 (조작 불가 작은 지도). "지도 보기"를 눌렀을 때만 부른다.
export async function mountView(el, p) {
  try {
    const L = await loadLeaflet();
    el.classList.add('map', 'map-small');
    const map = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, keyboard: false, attributionControl: true }).setView([p.lat, p.lng], 16);
    tiles(L).addTo(map);
    L.marker([p.lat, p.lng], { icon: pinIcon(L) }).addTo(map);
    setTimeout(() => map.invalidateSize(), 50);
  } catch {
    el.remove();
  }
}
