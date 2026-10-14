/* =========================================================
   service-worker.js — 오프라인 지원 담당
   한 번 접속하면 앱 파일을 폰에 저장해두고,
   인터넷이 끊겨도 행사 목록·찜한 행사의 부스 배치도를 볼 수 있게 해줘요.

   ★ 앱 파일(html/css/js)을 수정해서 다시 배포할 땐
     아래 CACHE_VERSION 숫자를 하나 올려주세요 (v6 → v7).
     그래야 사용자 폰에 새 버전이 적용돼요.
   ========================================================= */
const CACHE_VERSION = 'v10';
const CACHE_NAME = 'goodsfair-' + CACHE_VERSION;
// 부스 배치도 그림 저장소: 앱 버전이 바뀌어도 지우지 않아요 (행사장에서 꺼내 보려고)
const OFFLINE_CACHE = 'goodsfair-offline-maps';

// 처음 설치할 때 저장해둘 파일 목록
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './events.json',
  './archive.json',
  './manifest.json',
  './privacy.html',
  './terms.html',
  './community.js',
  './community-backend-demo.js',
  './community-backend-firebase.js',
  './firebase-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1) 설치: 앱 파일 저장
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
  );
  self.skipWaiting(); // 새 버전을 바로 적용
});

// 2) 활성화: 예전 버전 저장소 지우기 (배치도 저장소는 남겨요)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 3) 앱이 "이 배치도들을 저장해줘" 하고 부탁하면 미리 내려받아 둬요
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'save-maps' || !Array.isArray(msg.urls)) return;
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then(async (cache) => {
      for (const u of msg.urls) {
        try {
          if (!(await cache.match(u))) await cache.add(u);
        } catch (e) { /* 하나 실패해도 나머지는 계속 */ }
      }
    })
  );
});

// 4) 요청 처리
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 지도 그림(타일)은 너무 많아서 저장하지 않고 그냥 인터넷에서 받아요
  if (url.hostname.includes('tile.openstreetmap.org')) return;
  // 커뮤니티 서버(Firebase·구글 로그인)는 항상 인터넷으로 — 저장하면 안 돼요
  if (/(gstatic|googleapis|firebaseapp|firebasestorage|google)\.(com|app)$/.test(url.hostname) || url.pathname.startsWith('/__/auth')) return;

  // 행사 데이터(events.json, archive.json)는 "인터넷 먼저" → 최신 정보를 우선,
  // 인터넷이 안 되면 저장해둔 것 사용
  if (url.pathname.endsWith('events.json') || url.pathname.endsWith('archive.json')) {
    const key = url.origin + url.pathname; // ?붙은 주소도 같은 저장본으로
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(key))
    );
    return;
  }

  // 부스 배치도 그림: 오프라인 저장소 먼저 찾아보기
  if (url.pathname.includes('/maps/')) {
    event.respondWith(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()); // 한 번 본 배치도는 저장해둬요
        return res;
      })
    );
    return;
  }

  // 나머지(앱 파일, 폰트, 지도 라이브러리)는 "저장본 먼저" → 빠르게 열림
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // 정상 응답이면 저장해두기 (다음번 오프라인 대비)
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
