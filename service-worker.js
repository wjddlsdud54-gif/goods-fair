/* =========================================================
   service-worker.js — 오프라인 지원 담당
   한 번 접속하면 앱 파일을 폰에 저장해두고,
   인터넷이 끊겨도 행사 목록·찜한 행사의 부스 배치도를 볼 수 있게 해줘요.

   ★ 앱 파일(html/css/js)을 수정해서 다시 배포할 땐
     아래 CACHE_VERSION 숫자를 하나 올려주세요 (v6 → v7).
     그래야 사용자 폰에 새 버전이 적용돼요.
   ========================================================= */
const CACHE_VERSION = 'v13';
const CACHE_NAME = 'goodsfair-' + CACHE_VERSION;
// 부스 배치도 그림 저장소: 앱 버전이 바뀌어도 지우지 않아요 (행사장에서 꺼내 보려고)
const OFFLINE_CACHE = 'goodsfair-offline-maps';
// 알림 설정·보낸 알림 기록: 서비스 워커는 localStorage를 못 써서 여기에 저장해요
const NOTIFY_CACHE = 'goodsfair-notify';

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
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_CACHE && k !== NOTIFY_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 3) 앱이 보내는 부탁 처리
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  // "이 배치도들을 저장해줘" → 미리 내려받아 둬요
  if (msg.type === 'save-maps' && Array.isArray(msg.urls)) {
    event.waitUntil(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        for (const u of msg.urls) {
          try {
            if (!(await cache.match(u))) await cache.add(u);
          } catch (e) { /* 하나 실패해도 나머지는 계속 */ }
        }
      })
    );
  }
  // "알림 설정이 바뀌었어" → 저장하고, 지금 한 번 확인
  if (msg.type === 'notify-prefs') {
    event.waitUntil(
      writeJSON('prefs', { prefs: msg.prefs || {}, favorites: msg.favorites || [] })
        .then(() => msg.check && checkNotify())
    );
  }
});

// 3-1) 앱이 꺼져 있어도 폰이 허락하면 하루 한 번쯤 깨워줘요 (설치한 앱, 크롬 계열)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'goodsfair-notify') event.waitUntil(checkNotify());
});

// 3-2) 알림을 누르면 앱 열기 (이미 열려 있으면 그 창으로)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); return win.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});

// ----- 알림 확인 -----
async function readJSON(name) {
  try {
    const res = await (await caches.open(NOTIFY_CACHE)).match('./__' + name);
    return res ? await res.json() : null;
  } catch (e) { return null; }
}
async function writeJSON(name, data) {
  const cache = await caches.open(NOTIFY_CACHE);
  await cache.put('./__' + name, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
}
function dayNumber(str) { // "2026-10-15" → 날짜 번호 (폰 시간 기준)
  const [y, m, d] = str.split('-').map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86400000);
}
async function loadEventsForNotify() {
  const url = new URL('events.json', self.registration.scope);
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) {
      caches.open(CACHE_NAME).then((c) => c.put(url.origin + url.pathname, res.clone()));
      return (await res.clone().json()).events || [];
    }
  } catch (e) { /* 인터넷이 없으면 저장본 */ }
  const cached = await caches.match(url.origin + url.pathname);
  return cached ? ((await cached.json()).events || []) : [];
}

async function checkNotify() {
  const saved = await readJSON('prefs');
  if (!saved) return;
  const { prefs, favorites } = saved;
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
  const events = await loadEventsForNotify();
  if (!events.length) return;

  const log = (await readJSON('log')) || { sent: {}, known: null };
  const now = new Date();
  const todayNum = Math.round(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000);
  const show = (title, body, tag, url) =>
    self.registration.showNotification(title, { body, tag, data: { url }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' })
      .catch(() => {});

  // ① 찜한 행사가 다가오면: 고른 시점(예: 하루 전, 당일) 중 지난 것 가운데 가장 가까운 것 하나만 알려요
  if (prefs.fav && Array.isArray(prefs.days) && prefs.days.length) {
    const days = [...prefs.days].sort((a, b) => a - b);
    for (const ev of events) {
      if (!favorites.includes(ev.id)) continue;
      const left = dayNumber(ev.startDate) - todayNum;
      if (left < 0) continue; // 이미 시작했거나 끝난 행사
      const step = days.find((d) => left <= d);
      if (step === undefined || log.sent[ev.id + ':' + step]) continue;
      await show(
        left === 0 ? `오늘 시작해요! ${ev.name}` : `D-${left} · ${ev.name}`,
        `${ev.startDate.replace(/-/g, '.')} 시작 · ${ev.venue || ''}`.trim(),
        'fav-' + ev.id,
        './#event=' + encodeURIComponent(ev.id)
      );
      days.filter((d) => d >= step).forEach((d) => { log.sent[ev.id + ':' + d] = 1; });
    }
  }

  // ② 새 행사: 처음 확인할 때는 목록만 기억해두고, 그다음부터 새로 생긴 행사를 알려요
  const ids = events.map((ev) => ev.id);
  if (log.known && prefs.newEvents) {
    const fresh = events.filter((ev) => !log.known.includes(ev.id));
    if (fresh.length === 1) {
      await show('새 행사가 올라왔어요', `${fresh[0].name} · ${fresh[0].startDate.replace(/-/g, '.')}`,
        'new-events', './#event=' + encodeURIComponent(fresh[0].id));
    } else if (fresh.length > 1) {
      await show(`새 행사 ${fresh.length}개가 올라왔어요`, fresh.slice(0, 3).map((ev) => ev.name).join(', ') + (fresh.length > 3 ? ' 외' : ''),
        'new-events', './');
    }
  }
  log.known = ids;
  // 목록에서 사라진 행사의 알림 기록은 정리
  Object.keys(log.sent).forEach((k) => { if (!ids.includes(k.slice(0, k.lastIndexOf(':')))) delete log.sent[k]; });
  await writeJSON('log', log);
}

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

  // 우리 앱 파일(html·js·css)은 "인터넷 먼저" → 업데이트하면 바로 새 화면이 보여요.
  // 인터넷이 없거나 4초 넘게 느리면 폰에 저장해둔 것으로 열어요.
  if (url.origin === self.location.origin && (req.mode === 'navigate' || /(\/|\.html|\.js|\.css)$/.test(url.pathname))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 나머지(그림, 폰트, 지도 라이브러리)는 "저장본 먼저" → 빠르게 열림
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

// 인터넷 먼저, 안 되면 저장본 (앱 파일용)
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const fromCache = () => cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('느림')), 4000))
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // 인터넷이 없거나 느릴 때: 저장본 → 그것도 없으면 첫 화면
    return (await fromCache()) || (await cache.match('./index.html')) || Response.error();
  }
}
