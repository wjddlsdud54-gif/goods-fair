/* =========================================================
   service-worker.js — 오프라인 지원 담당
   한 번 접속하면 앱 파일을 폰에 저장해두고,
   인터넷이 끊겨도 행사 목록을 볼 수 있게 해줘요.

   ★ 앱 파일(html/css/js)을 수정해서 다시 배포할 땐
     아래 CACHE_VERSION 숫자를 하나 올려주세요 (v1 → v2).
     그래야 사용자 폰에 새 버전이 적용돼요.
   ========================================================= */
const CACHE_VERSION = 'v4';
const CACHE_NAME = 'goodsfair-' + CACHE_VERSION;

// 처음 설치할 때 저장해둘 파일 목록
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './events.json',
  './manifest.json',
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

// 2) 활성화: 예전 버전 저장소 지우기
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 3) 요청 처리
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 지도 그림(타일)은 너무 많아서 저장하지 않고 그냥 인터넷에서 받아요
  if (url.hostname.includes('tile.openstreetmap.org')) return;

  // events.json 은 "인터넷 먼저" → 최신 행사 정보를 우선 보여주고,
  // 인터넷이 안 되면 저장해둔 것 사용
  if (url.pathname.endsWith('events.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
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
