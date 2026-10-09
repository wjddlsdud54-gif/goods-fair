/* =========================================================
   app.js — 앱의 "동작"을 담당해요
   (데이터 불러오기, 카드 그리기, 검색·필터, 지도, 상세 화면, 즐겨찾기)
   ========================================================= */

// ---------------------------------------------------------
// 0. 앱 전체에서 함께 쓰는 상태(State) 값
// ---------------------------------------------------------
const state = {
  events: [],          // events.json에서 불러온 행사 목록
  filter: 'all',       // 선택된 지역·날짜 필터: all / month / 서울 / 경기 / 부산 / etc
  category: 'all',     // 선택된 분야 필터: all / 일러스트 / 애니·만화 / 게임 / 동인·코스프레 / 캐릭터·굿즈
  hideEnded: false,    // '종료 제외' 켜짐 여부
  query: '',           // 검색어
  tab: 'list',         // 현재 탭: list / map / fav
  favorites: new Set() // 즐겨찾기한 행사 id 모음
};

// 지도 객체들 (한 번 만들면 재사용)
let allMap = null;        // 지도 탭의 전체 지도
let allMapLayer = null;   // 전체 지도 위의 핀 묶음
let detailMap = null;     // 상세 화면의 작은 지도

// 자주 쓰는 화면 요소를 미리 찾아두기
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------
// 1. 안전한 저장소 (localStorage)
//    사생활 보호 모드 등에서는 localStorage가 막혀 있을 수 있어서
//    try/catch 로 감싸 오류가 나도 앱이 멈추지 않게 해요.
// ---------------------------------------------------------
const FAV_KEY = 'goodsfair.favorites';

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    state.favorites = new Set(saved);
  } catch (e) {
    state.favorites = new Set(); // 저장소를 못 쓰면 빈 상태로 시작 (메모리에만 저장)
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites]));
  } catch (e) {
    /* 저장이 안 되는 환경이면 조용히 무시 — 앱이 켜져 있는 동안은 즐겨찾기 유지 */
  }
}

// ---------------------------------------------------------
// 2. 날짜 계산 도우미
// ---------------------------------------------------------

// "2026-10-15" 같은 글자를 날짜 객체로 바꾸기 (시간대 문제를 피하려고 직접 쪼개요)
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 오늘 날짜 (시·분·초는 0으로)
function today() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

// 두 날짜 사이의 일 수
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// 행사 상태 계산: 'ongoing'(진행 중) / 'upcoming'(예정) / 'ended'(종료)
function getStatus(ev) {
  const t = today();
  const start = parseDate(ev.startDate);
  const end = parseDate(ev.endDate);
  if (t < start) return 'upcoming';
  if (t > end) return 'ended';
  return 'ongoing';
}

// D-day 글자 만들기
function getDday(ev) {
  const status = getStatus(ev);
  if (status === 'ongoing') return 'D-DAY';
  if (status === 'ended') return '';
  return 'D-' + daysBetween(today(), parseDate(ev.startDate));
}

// 날짜를 보기 좋게: 2026.10.15 (목)
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDate(str) {
  const d = parseDate(str);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${WEEK[d.getDay()]})`;
}
function fmtRange(ev) {
  if (ev.startDate === ev.endDate) return fmtDate(ev.startDate);
  // 카드에는 짧게: 10.15 ~ 10.19
  return `${fmtDate(ev.startDate)} ~ ${fmtDate(ev.endDate).slice(5)}`;
}

const STATUS_LABEL = { ongoing: '진행 중', upcoming: '예정', ended: '종료' };

// ---------------------------------------------------------
// 3. 보안 도우미: 글자를 HTML에 넣기 전에 특수문자 바꾸기
//    (events.json에 <, > 같은 글자가 있어도 화면이 깨지지 않게)
// ---------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 이미지가 없을 때 쓸 파스텔 그라데이션 (행사 id에 따라 색이 고정돼요)
const GRADIENTS = [
  'linear-gradient(135deg,#ffc3d8,#ffe7b3)',
  'linear-gradient(135deg,#c8e7ff,#e2d4ff)',
  'linear-gradient(135deg,#c9f2e3,#d4f1ff)',
  'linear-gradient(135deg,#ffd9c2,#ffc3e1)',
  'linear-gradient(135deg,#e2d4ff,#ffd6e7)',
  'linear-gradient(135deg,#fff2a8,#c9f2e3)'
];
const EMOJIS = ['🎨', '✏️', '📚', '🧸', '🖼️', '🎀'];
// 분야별 그림 (행사의 첫 번째 분야를 보고 골라요)
const CATEGORY_EMOJI = {
  '일러스트': '🎨', '애니·만화': '📺', '게임': '🎮',
  '동인·코스프레': '👘', '캐릭터·굿즈': '🧸', '문화': '🎎'
};
// 예전 형식(category 하나만 적은 경우)도 읽을 수 있게 배열로 맞춰주기
function cats(ev) {
  if (Array.isArray(ev.categories)) return ev.categories;
  return ev.category ? [ev.category] : [];
}
// 분야별 티켓 색 (style.css의 .tone-… 와 짝이에요)
const CATEGORY_TONE = {
  '일러스트': 'illust', '애니·만화': 'anime', '게임': 'game',
  '동인·코스프레': 'cos', '캐릭터·굿즈': 'goods', '문화': 'culture'
};
function toneFor(ev) {
  return 'tone-' + (CATEGORY_TONE[cats(ev)[0]] || 'illust');
}
// 짧은 날짜: 10.10 토
function fmtShort(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} ${WEEK[d.getDay()]}`;
}
function fmtShortRange(ev) {
  return ev.startDate === ev.endDate ? fmtShort(ev.startDate) : `${fmtShort(ev.startDate)} – ${fmtShort(ev.endDate)}`;
}
// 티켓 오른쪽(떼는 부분)에 크게 들어갈 글자
function stubText(ev) {
  const status = getStatus(ev);
  if (status === 'ongoing') return '오늘';
  if (status === 'ended') return '종료';
  return getDday(ev);
}

function emojiFor(ev) {
  return CATEGORY_EMOJI[cats(ev)[0]] || EMOJIS[pickIndex(ev.id)];
}
function pickIndex(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % GRADIENTS.length;
}
function coverStyle(ev) {
  if (ev.image) return `background-image:url('${esc(ev.image)}')`;
  return `background:${GRADIENTS[pickIndex(ev.id)]}`;
}
function coverEmoji(ev) {
  return ev.image ? '' : `<span class="cover-emoji" aria-hidden="true">${emojiFor(ev)}</span>`;
}

// ---------------------------------------------------------
// 4. 데이터 불러오기 (events.json)
// ---------------------------------------------------------
async function loadEvents() {
  try {
    const res = await fetch('events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    // events.json은 { "events": [...] } 형태예요
    state.events = Array.isArray(data) ? data : (data.events || []);
    state.updatedAt = data.updatedAt || ''; // 마지막 업데이트 날짜
  } catch (err) {
    console.error('events.json을 불러오지 못했어요:', err);
    $('#listEmpty').hidden = false;
    $('#listEmpty').innerHTML =
      '행사 데이터를 불러오지 못했어요 😢<br><small>index.html을 더블클릭해서 열면 이렇게 돼요. ' +
      '설명서의 "내 컴퓨터에서 실행하기" 방법(로컬 서버)으로 열어주세요.</small>';
    return;
  }

  // 안내 띠: 예시 데이터가 섞여 있으면 경고, 아니면 마지막 업데이트 날짜 표시
  const banner = $('#sampleBanner');
  if (state.events.some((ev) => ev.isSample)) {
    banner.innerHTML = '⚠️ 일부 날짜·장소는 <b>예시값</b>이에요. <code>events.json</code>에서 실제 정보로 바꿔주세요.';
    banner.hidden = false;
  } else if (state.updatedAt) {
    banner.innerHTML = `${esc(state.updatedAt.replace(/-/g, '.'))} 기준 정보예요. 방문 전에 공식 공지를 꼭 확인하세요.`;
    banner.classList.add('is-info');
    banner.hidden = false;
  }
}

// ---------------------------------------------------------
// 5. 정렬 + 필터 + 검색
// ---------------------------------------------------------

// 정렬 규칙: 진행 중 → 예정(가까운 순) → 종료(최근 끝난 순, 맨 아래)
function sortEvents(list) {
  const order = { ongoing: 0, upcoming: 1, ended: 2 };
  return [...list].sort((a, b) => {
    const sa = getStatus(a), sb = getStatus(b);
    if (sa !== sb) return order[sa] - order[sb];
    if (sa === 'ended') return parseDate(b.endDate) - parseDate(a.endDate);
    return parseDate(a.startDate) - parseDate(b.startDate);
  });
}

// index.html에 있는 지역 필터 버튼 목록 (예: ['서울', '부산'])
// → index.html에 <button class="chip" data-filter="대구">대구</button> 를 추가하면 자동으로 동작해요
function regionChips() {
  return [...$$('.chip[data-filter]')]
    .map((c) => c.dataset.filter)
    .filter((f) => !['all', 'month', 'etc'].includes(f));
}

// 필터 조건에 맞는지 검사
function matchesFilter(ev) {
  const f = state.filter;
  if (state.hideEnded && getStatus(ev) === 'ended') return false;

  // 분야 필터: 행사의 categories 중 하나라도 같으면 통과
  if (state.category !== 'all' && !cats(ev).includes(state.category)) return false;

  if (f === 'month') {
    // 이번 달에 조금이라도 걸쳐 있는 행사
    const t = today();
    const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
    const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    if (parseDate(ev.endDate) < monthStart || parseDate(ev.startDate) > monthEnd) return false;
  } else if (f === 'etc') {
    // '기타 지역' = 필터 버튼이 따로 없는 지역 (경기, 대구 등)
    if (regionChips().includes(ev.region)) return false;
  } else if (f !== 'all') {
    // 그 밖의 버튼(서울, 부산 등)은 버튼 글자와 region 값이 같은 행사만
    if (ev.region !== f) return false;
  }

  // 검색어: 행사명, 장소, 주소, 지역에서 찾기 (띄어쓰기·대소문자 무시)
  if (state.query) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s/g, '');
    const booths = (ev.boothMap?.groups || []).flatMap((g) => (g.booths || []).map((b) => b.name + b.code)).join('');
    const hay = norm(ev.name) + norm(ev.venue) + norm(ev.address) + norm(ev.region) + norm(cats(ev).join('')) + norm(booths);
    if (!hay.includes(norm(state.query))) return false;
  }
  return true;
}

// ---------------------------------------------------------
// 6. 카드 그리기
// ---------------------------------------------------------
function cardHTML(ev) {
  const status = getStatus(ev);
  const isFav = state.favorites.has(ev.id);
  // 티켓 모양: 왼쪽(본권) + 점선 + 오른쪽(떼는 부분)
  return `
    <button class="ticket ${toneFor(ev)} is-${status}" data-id="${esc(ev.id)}"
            aria-label="${esc(ev.name)}, ${fmtShortRange(ev)}, ${STATUS_LABEL[status]} — 상세 보기">
      <div class="ticket-main">
        ${catTags(ev)}
        <h2 class="ticket-name">${esc(ev.name)}</h2>
        ${(() => { const hits = boothHits(ev); return hits.length ? `<p class="booth-hit">부스 ${hits.slice(0, 2).map((b) => `<b>${esc(b.code)}</b> ${esc(b.name)}`).join(', ')}${hits.length > 2 ? ` 외 ${hits.length - 2}곳` : ''}</p>` : ''; })()}
        <dl class="ticket-fields">
          <div><dt>날짜</dt><dd>${fmtShortRange(ev)}</dd></div>
          <div><dt>장소</dt><dd>${esc(ev.venue)}</dd></div>
        </dl>
        <div class="ticket-foot">
          ${status === 'ended' ? '<span class="stamp" aria-hidden="true">입장 마감</span>' : '<span class="barcode" aria-hidden="true"></span>'}
          ${ev.boothMap ? '<span class="has-map">부스 배치도</span>' : ''}
        </div>
      </div>
      <div class="ticket-stub">
        ${isFav ? '<span class="stub-fav" aria-label="찜한 행사">★</span>' : ''}
        <strong class="stub-big">${stubText(ev)}</strong>
        <span class="stub-small">${status === 'upcoming' ? fmtShort(ev.startDate) : status === 'ongoing' ? '진행 중' : '~' + fmtShort(ev.endDate)}</span>
      </div>
    </button>`;
}

// 메인 검색어와 맞는 부스 찾기 (티켓에 "B-1 JCB카드"처럼 보여주려고)
function boothHits(ev) {
  if (!state.query || !ev.boothMap) return [];
  const norm = (x) => String(x || '').toLowerCase().replace(/\s/g, '');
  const q = norm(state.query);
  return (ev.boothMap.groups || []).flatMap((g) => g.booths || [])
    .filter((b) => norm(b.name).includes(q) || norm(b.code) === q);
}

// 분야 태그 (#게임 #코스프레 …)
function catTags(ev) {
  const list = cats(ev);
  if (!list.length) return '';
  return `<p class="cat-tags">${list.map((c) => `<span>#${esc(c)}</span>`).join(' ')}</p>`;
}

// 목록 탭 그리기
function renderList() {
  if (!state.events.length) return;
  const list = sortEvents(state.events.filter(matchesFilter));
  $('#listGrid').innerHTML = list.map(cardHTML).join('');
  $('#listEmpty').hidden = list.length > 0;
  renderHero();
}

// 상단 큰 제목: 오늘 열리는 행사 수, 없으면 다음 행사까지 남은 날
function renderHero() {
  const ongoing = state.events.filter((ev) => getStatus(ev) === 'ongoing');
  const next = sortEvents(state.events.filter((ev) => getStatus(ev) === 'upcoming'))[0];
  let title = '굿즈행사 캘린더';
  if (ongoing.length) title = `오늘 열리는<br>행사 ${ongoing.length}곳`;
  else if (next) title = `다음 행사까지<br>${getDday(next)}`;
  $('#heroTitle').innerHTML = title;
  const upcomingCount = state.events.filter((ev) => getStatus(ev) !== 'ended').length;
  $('#heroSub').textContent = `다가오는 일러스트·애니·게임·코스프레 행사 ${upcomingCount}개`;
}

// 즐겨찾기 탭 그리기
function renderFavorites() {
  const list = sortEvents(state.events.filter((ev) => state.favorites.has(ev.id)));
  $('#favGrid').innerHTML = list.map(cardHTML).join('');
  $('#favEmpty').hidden = list.length > 0;
}

// ---------------------------------------------------------
// 7. 지도 (Leaflet + OpenStreetMap)
// ---------------------------------------------------------

// OpenStreetMap 지도 타일 (무료, API 키 불필요)
function addTiles(map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

// 귀여운 핀 아이콘 만들기
function makePin(ev) {
  const status = getStatus(ev);
  return L.divIcon({
    className: '',
    html: `<div class="pin ${toneFor(ev)} is-${status}"><span>${status === 'ongoing' ? '오늘' : (getDday(ev) || '종료')}</span></div>`,
    iconSize: [54, 30],
    iconAnchor: [27, 38],   // 꼬리 끝이 위치를 가리키도록
    popupAnchor: [0, -36]
  });
}

// 좌표가 제대로 들어있는 행사만
const hasCoords = (ev) => typeof ev.lat === 'number' && typeof ev.lng === 'number';

// 지도 탭: 모든 행사장 핀 표시
function renderAllMap() {
  if (typeof L === 'undefined') {
    $('#allMap').innerHTML = '<p class="empty">지도를 불러오려면 인터넷 연결이 필요해요.</p>';
    return;
  }
  if (!allMap) {
    allMap = L.map('allMap', { zoomControl: true }).setView([36.5, 127.8], 7); // 대한민국 중심
    addTiles(allMap);
    allMapLayer = L.layerGroup().addTo(allMap);
    // 팝업 안의 '자세히 보기' 버튼 연결
    // (Leaflet 팝업은 클릭이 바깥으로 전달되지 않아서 여기서 직접 걸어줘요)
    allMap.on('popupopen', (e) => {
      e.popup.getElement().querySelectorAll('[data-open]').forEach((btn) => {
        btn.onclick = () => goToEvent(btn.dataset.open);
      });
    });
  }
  allMapLayer.clearLayers();

  // 같은 장소(예: 코엑스)에 여러 행사가 있으면 핀 하나에 묶어서 보여줘요
  const groups = {};
  state.events.filter(hasCoords).forEach((ev) => {
    const key = ev.lat.toFixed(4) + ',' + ev.lng.toFixed(4);
    (groups[key] = groups[key] || []).push(ev);
  });

  const bounds = [];
  Object.values(groups).forEach((evs) => {
    const sorted = sortEvents(evs);
    const main = sorted[0];
    const popup = sorted.map((ev) => {
      const status = getStatus(ev);
      return `<div class="popup-card ${toneFor(ev)}">
          <span class="popup-status">${stubText(ev)}</span>
          <h3>${esc(ev.name)}</h3>
          <p>${fmtShortRange(ev)}<br>${esc(ev.venue)}</p>
          <button data-open="${esc(ev.id)}">티켓 보기</button>
        </div>`;
    }).join('<hr class="popup-sep">');
    L.marker([main.lat, main.lng], { icon: makePin(main) }).bindPopup(popup).addTo(allMapLayer);
    bounds.push([main.lat, main.lng]);
  });

  // 모든 핀이 한 화면에 보이도록 확대/축소
  if (bounds.length) allMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  // 탭이 숨겨져 있다가 보이면 지도 크기를 다시 계산해야 해요
  setTimeout(() => allMap.invalidateSize(), 50);
}

// ---------------------------------------------------------
// 8. 캘린더에 추가 (.ics 파일 + 구글 캘린더 링크)
// ---------------------------------------------------------

// 날짜를 20261015 형태로
function ymd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
// 캘린더는 '종료일 다음 날'까지로 적어야 마지막 날이 포함돼요
function endExclusive(ev) {
  const d = parseDate(ev.endDate);
  d.setDate(d.getDate() + 1);
  return d;
}

function googleCalendarURL(ev) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.name,
    dates: `${ymd(parseDate(ev.startDate))}/${ymd(endExclusive(ev))}`,
    details: `${ev.hours ? '운영시간: ' + ev.hours + '\n' : ''}${ev.links?.homepage || ''}`,
    location: `${ev.venue} ${ev.address || ''}`.trim()
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

// .ics 파일 만들어서 내려받기 (아이폰·갤럭시·아웃룩 캘린더 모두 지원)
function downloadICS(ev) {
  const icsEsc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//goodsfair//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.id}@goodsfair`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART;VALUE=DATE:${ymd(parseDate(ev.startDate))}`,
    `DTEND;VALUE=DATE:${ymd(endExclusive(ev))}`,
    `SUMMARY:${icsEsc(ev.name)}`,
    `LOCATION:${icsEsc(ev.venue + ' ' + (ev.address || ''))}`,
    `DESCRIPTION:${icsEsc((ev.hours ? '운영시간: ' + ev.hours + '\n' : '') + (ev.links?.homepage || ''))}`,
    // 하루 전 알림
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(ev.name)} 내일 시작!`, 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ev.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------
// 9. 상세 화면
// ---------------------------------------------------------

// 길찾기 링크
const kakaoURL = (ev) => hasCoords(ev)
  ? `https://map.kakao.com/link/to/${encodeURIComponent(ev.venue)},${ev.lat},${ev.lng}`
  : `https://map.kakao.com/?q=${encodeURIComponent(ev.address || ev.venue)}`;
const naverURL = (ev) => `https://map.naver.com/p/search/${encodeURIComponent(ev.address || ev.venue)}`;

function detailHTML(ev) {
  const status = getStatus(ev);
  const dday = getDday(ev);
  const isFav = state.favorites.has(ev.id);
  const links = ev.links || {};

  // 관련 링크: 값이 있는 것만 버튼으로 만들기
  const linkDefs = [
    ['ticket', '예매하기'],
    ['homepage', '공식 홈페이지'],
    ['instagram', '인스타그램'],
    ['x', 'X(트위터)']
  ];
  const linkBtns = linkDefs
    .filter(([key]) => links[key])
    .map(([key, label]) =>
      `<a class="btn ${key === 'ticket' ? 'btn-primary' : ''}" href="${esc(links[key])}" target="_blank" rel="noopener">${label}</a>`)
    .join('');

  // 정보 표: 값이 있는 줄만 보여주기
  const rows = [
    ['날짜', ev.startDate === ev.endDate ? fmtDate(ev.startDate) : `${fmtDate(ev.startDate)} ~ ${fmtDate(ev.endDate)}`],
    ['시간', ev.hours],
    ['장소', ev.venue],
    ['주소', ev.address],
    ['입장료', ev.price]
  ].filter(([, v]) => v).map(([k, v]) => `<div class="field${k === '주소' || k === '날짜' ? ' wide' : ''}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

  return `
    <div class="sheet-ticket ${toneFor(ev)} is-${status}">
      <header class="sheet-stub">
        <button class="detail-close" id="detailClose" aria-label="닫기">✕</button>
        <strong class="sheet-big">${stubText(ev)}</strong>
        <span class="sheet-status">${STATUS_LABEL[status]}${ev.isSample ? ' · 예시 데이터' : ''}</span>
      </header>
      <div class="sheet-main">
        ${catTags(ev)}
        <h2 class="detail-title" id="detailTitle">${esc(ev.name)}</h2>
        <dl class="sheet-fields">${rows}</dl>
        <button class="fav-btn" id="favBtn" aria-pressed="${isFav}">${isFav ? '★ 찜한 행사' : '☆ 찜하기'}</button>
        ${status === 'ended' ? '<span class="stamp stamp-lg" aria-hidden="true">입장 마감</span>' : '<span class="barcode barcode-lg" aria-hidden="true"></span>'}
      </div>
    </div>

    <div class="detail-content">
      ${ev.description ? `<p class="desc">${esc(ev.description)}</p>` : ''}

      <h3 class="section-title">일정 저장</h3>
      <div class="btn-row">
        <button class="btn" id="icsBtn">캘린더 파일 받기</button>
        <a class="btn" href="${googleCalendarURL(ev)}" target="_blank" rel="noopener">구글 캘린더에 추가</a>
      </div>

      <h3 class="section-title">오시는 길</h3>
      ${hasCoords(ev) ? '<div class="detail-map" id="detailMap"></div>' : ''}
      <div class="btn-row">
        <a class="btn btn-kakao" href="${kakaoURL(ev)}" target="_blank" rel="noopener">카카오맵 길찾기</a>
        <a class="btn btn-naver" href="${naverURL(ev)}" target="_blank" rel="noopener">네이버지도 길찾기</a>
      </div>

      ${boothHTML(ev)}

      ${linkBtns ? `<h3 class="section-title">관련 링크</h3><div class="btn-row">${linkBtns}</div>` : ''}

      ${ev.source ? `<p class="source"><a href="${esc(ev.source)}" target="_blank" rel="noopener">정보 출처 보기</a> — 일정은 바뀔 수 있으니 공식 공지를 확인하세요.</p>` : ''}
    </div>`;
}

// ---------------------------------------------------------
// 9-1. 부스 배치도 (events.json의 boothMap)
//   boothMap: {
//     image: "maps/파일.png",      ← 배치도 그림 (없으면 생략)
//     link:  "https://...",        ← 공식 배치도 페이지 (그림이 없을 때)
//     note, source,
//     groups: [{ name, color, booths: [{ code, size, name }] }]
//   }
// ---------------------------------------------------------
function boothHTML(ev) {
  const bm = ev.boothMap;
  if (!bm) return '';
  const groups = bm.groups || [];
  const total = groups.reduce((n, g) => n + (g.booths || []).length, 0);

  const groupHTML = groups.map((g, i) => `
    <details class="booth-group" ${i === 0 ? 'open' : ''} style="--gcolor:${esc(g.color || '#8a93a8')}">
      <summary><i class="gdot"></i>${esc(g.name)} <span class="gcount">${(g.booths || []).length}</span></summary>
      <ul class="booth-list">
        ${(g.booths || []).map((b) => `
          <li class="booth${b.pos ? ' has-pos' : ''}" ${b.pos ? `tabindex="0" role="button" data-pos="${esc(b.pos.join(','))}" aria-label="${esc(b.code + ' ' + b.name)} 배치도에서 위치 보기"` : ''} data-code="${esc(String(b.code).toLowerCase().replace(/\s/g, ''))}" data-search="${esc((b.code + ' ' + b.name).toLowerCase().replace(/\s/g, ''))}">
            <b class="booth-code">${esc(b.code)}</b>
            <span class="booth-name">${esc(b.name)}</span>
            <span class="booth-size">${esc(b.size || '')}${b.pos ? '<svg class="pin-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>' : ''}</span>
          </li>`).join('')}
      </ul>
    </details>`).join('');

  return `
    <h3 class="section-title">부스 배치도</h3>
    ${bm.image ? `
      <button class="booth-map" id="boothMapBtn" aria-label="부스 배치도 크게 보기">
        <span class="map-frame">
          <img src="${esc(bm.image)}" alt="${esc(ev.name)} 부스 배치도" loading="lazy" />
          <span class="booth-mark" id="boothMark" hidden></span>
        </span>
        <span class="booth-map-hint">눌러서 크게 보기</span>
      </button>
      <p class="booth-picked" id="boothPicked" hidden></p>` : ''}
    ${bm.image && groups.some((g) => (g.booths || []).some((b) => b.pos)) ? '<p class="booth-tip">아래 목록에서 부스를 누르면 배치도에 위치가 표시돼요.</p>' : ''}
    ${!bm.image && bm.link ? `<div class="btn-row one"><a class="btn btn-primary" href="${esc(bm.link)}" target="_blank" rel="noopener">공식 부스 배치도 보기</a></div>` : ''}
    ${total ? `
      <label class="search booth-search">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input id="boothSearch" type="search" placeholder="부스 번호·이름 찾기 (예: A-12)" autocomplete="off" aria-label="부스 검색" />
      </label>
      <p class="booth-empty" id="boothEmpty" hidden>찾는 부스가 없어요. 번호나 이름을 다시 확인해보세요.</p>
      <div class="booth-groups" id="boothGroups">${groupHTML}</div>` : ''}
    ${bm.note ? `<p class="source">${esc(bm.note)}${bm.source ? ` <a href="${esc(bm.source)}" target="_blank" rel="noopener">배치도 출처</a>` : ''}</p>` : ''}`;
}

// 부스 검색: 번호·이름에 검색어가 들어간 부스만 보여주기
function bindBoothSearch() {
  const input = $('#boothSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().replace(/\s/g, '');
    let shown = 0;
    // "A-1"처럼 부스 번호를 정확히 쓰면 그 부스만 (A-10, A-11… 은 빼고)
    const exact = q && [...$$('#boothGroups .booth')].some((li) => li.dataset.code === q);
    $$('#boothGroups .booth-group').forEach((g) => {
      let n = 0;
      g.querySelectorAll('.booth').forEach((li) => {
        const hit = !q || (exact ? li.dataset.code === q : li.dataset.search.includes(q));
        li.hidden = !hit;
        if (hit) n++;
      });
      g.hidden = n === 0;
      if (q && n) g.open = true; // 검색 중에는 결과가 있는 묶음을 펼쳐요
      shown += n;
    });
    $('#boothEmpty').hidden = shown > 0;
    // 결과가 하나뿐이면 바로 배치도에 표시
    const visible = [...$$('#boothGroups .booth.has-pos')].filter((li) => !li.hidden && !li.closest('.booth-group').hidden);
    if (q && visible.length === 1) markBooth(visible[0], false);
  });

  // 부스를 누르면 배치도에 위치 표시
  $$('#boothGroups .booth.has-pos').forEach((li) => {
    li.addEventListener('click', () => markBooth(li, true));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); markBooth(li, true); } });
  });
}

// 배치도 위에 부스 위치를 반짝이는 테두리로 표시
let markedPos = null; // 크게 보기 화면에서도 같은 위치를 표시하려고 기억해둬요
function placeMark(el, pos) {
  const [x, y, w, h] = pos;
  const pad = 1.2; // 테두리가 부스를 살짝 감싸도록 여유
  el.style.left = (x - pad) + '%';
  el.style.top = (y - pad) + '%';
  el.style.width = (w + pad * 2) + '%';
  el.style.height = (h + pad * 2) + '%';
  el.hidden = false;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); // 애니메이션 다시 시작
}
function markBooth(li, scroll) {
  const mark = $('#boothMark');
  if (!mark) return;
  markedPos = li.dataset.pos.split(',').map(Number);
  placeMark(mark, markedPos);
  $$('#boothGroups .booth.is-picked').forEach((x) => x.classList.remove('is-picked'));
  li.classList.add('is-picked');
  const picked = $('#boothPicked');
  picked.innerHTML = `<b>${esc(li.querySelector('.booth-code').textContent)}</b> ${esc(li.querySelector('.booth-name').textContent)} — 여기예요!`;
  picked.hidden = false;
  if (scroll) $('#boothMapBtn').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// 배치도 크게 보기 (손가락으로 확대·이동 가능)
function openMapViewer(src, alt) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', '부스 배치도');
  v.innerHTML = `
    <div class="viewer-bar">
      <button class="viewer-btn" data-z="-1" aria-label="축소">−</button>
      <button class="viewer-btn" data-z="1" aria-label="확대">＋</button>
      <button class="viewer-btn viewer-close" aria-label="닫기">✕</button>
    </div>
    <div class="viewer-scroll"><div class="map-frame viewer-frame"><img src="${esc(src)}" alt="${esc(alt)}" /><span class="booth-mark" hidden></span></div></div>`;
  document.body.appendChild(v);
  const img = v.querySelector('.viewer-frame');
  if (markedPos) placeMark(v.querySelector('.booth-mark'), markedPos);
  let zoom = markedPos ? 2 : 1; // 표시된 부스가 있으면 확대해서 열기
  const apply = () => {
    img.style.width = (zoom * 100) + '%';
    if (markedPos) { // 표시된 부스가 화면 가운데 오도록 스크롤
      const sc = v.querySelector('.viewer-scroll');
      const center = () => {
        sc.scrollLeft = img.offsetWidth * (markedPos[0] + markedPos[2] / 2) / 100 - sc.clientWidth / 2;
        sc.scrollTop = img.offsetHeight * (markedPos[1] + markedPos[3] / 2) / 100 - sc.clientHeight / 2;
      };
      const pic = img.querySelector('img');
      if (pic.complete) requestAnimationFrame(center); else pic.onload = center; // 그림이 다 뜬 뒤에 가운데로
    }
  };
  apply();
  v.querySelectorAll('[data-z]').forEach((b) => {
    b.onclick = () => { zoom = Math.min(4, Math.max(1, zoom + Number(b.dataset.z) * 0.5)); apply(); };
  });
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  v.querySelector('.viewer-close').onclick = close;
  document.addEventListener('keydown', onKey);
  v.querySelector('.viewer-close').focus();
}

let lastFocus = null; // 상세 화면을 닫으면 원래 누른 카드로 돌아가기 위해

function openDetail(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  lastFocus = document.activeElement;

  const box = $('#detail');
  box.innerHTML = detailHTML(ev);
  box.hidden = false;
  $('#detailBackdrop').hidden = false;
  box.scrollTop = 0;
  document.body.classList.add('no-scroll');

  // 버튼 동작 연결
  $('#detailClose').onclick = closeDetail;
  $('#icsBtn').onclick = () => downloadICS(ev);
  $('#favBtn').onclick = () => toggleFavorite(ev.id);
  markedPos = null;
  bindBoothSearch();
  // 메인 검색어가 이 행사의 부스와 맞으면, 부스 검색에 자동으로 넣고 위치까지 표시
  const bs = $('#boothSearch');
  if (bs && state.query && boothHits(ev).length) {
    bs.value = state.query;
    bs.dispatchEvent(new Event('input'));
    const first = [...$$('#boothGroups .booth.has-pos')].find((li) => !li.hidden);
    if (first) setTimeout(() => markBooth(first, true), 350);
  }
  const mapBtn = $('#boothMapBtn');
  if (mapBtn) mapBtn.onclick = () => openMapViewer(ev.boothMap.image, ev.name + ' 부스 배치도');

  // 상세 지도 만들기 (이전 지도는 지우고 새로)
  if (detailMap) { detailMap.remove(); detailMap = null; }
  if (hasCoords(ev) && typeof L !== 'undefined') {
    detailMap = L.map('detailMap', { scrollWheelZoom: false }).setView([ev.lat, ev.lng], 15);
    addTiles(detailMap);
    L.marker([ev.lat, ev.lng], { icon: makePin(ev) }).addTo(detailMap).bindPopup(esc(ev.venue));
    setTimeout(() => detailMap && detailMap.invalidateSize(), 250);
  }
  $('#detailClose').focus();
}

// 닫기: 주소창의 #event=... 를 지우면 hashchange가 실제로 닫아요
function closeDetail() {
  if (location.hash.startsWith('#event=')) {
    history.back(); // 폰의 '뒤로 가기'와 똑같이 동작
  } else {
    hideDetail();
  }
}

function hideDetail() {
  $('#detail').hidden = true;
  $('#detailBackdrop').hidden = true;
  document.body.classList.remove('no-scroll');
  if (detailMap) { detailMap.remove(); detailMap = null; }
  if (lastFocus) lastFocus.focus({ preventScroll: true });
}

// 주소(#event=id)에 따라 상세 화면 열기/닫기 → 폰에서 뒤로 가기 버튼이 자연스럽게 동작
function handleHash() {
  const m = location.hash.match(/^#event=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
  else if (!$('#detail').hidden) hideDetail();
}

// 카드 누르면 주소만 바꾸기 (그러면 handleHash가 상세를 열어요)
function goToEvent(id) {
  location.hash = 'event=' + encodeURIComponent(id);
}

// ---------------------------------------------------------
// 10. 즐겨찾기
// ---------------------------------------------------------
function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();

  // 버튼 모양 바꾸기
  const btn = $('#favBtn');
  const on = state.favorites.has(id);
  if (btn) {
    btn.setAttribute('aria-pressed', on);
    btn.textContent = on ? '★ 찜한 행사' : '☆ 찜하기';
  }
  renderList();
  renderFavorites();
}

// ---------------------------------------------------------
// 11. 탭 전환
// ---------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + tab));
  // 지도 탭에서는 검색·필터가 필요 없으니 숨겨요
  $('#filterChips').style.display = tab === 'list' ? '' : 'none';
  $('#categoryChips').style.display = tab === 'list' ? '' : 'none';
  $('.search').style.display = tab === 'list' ? '' : 'none';

  if (tab === 'map') renderAllMap();
  if (tab === 'fav') renderFavorites();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------
// 12. 버튼·입력 이벤트 연결
// ---------------------------------------------------------
function bindEvents() {
  // 필터 칩
  $$('.chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      $$('.chip[data-filter]').forEach((c) => c.classList.toggle('is-active', c === chip));
      renderList();
    });
  });

  // 분야 칩
  $$('.chip[data-category]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.category = chip.dataset.category;
      $$('.chip[data-category]').forEach((c) => c.classList.toggle('is-active', c === chip));
      renderList();
    });
  });

  // 종료 제외 토글
  $('#hideEndedBtn').addEventListener('click', (e) => {
    state.hideEnded = !state.hideEnded;
    e.currentTarget.setAttribute('aria-pressed', state.hideEnded);
    renderList();
  });

  // 검색 (글자 입력할 때마다 바로 반영)
  $('#searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderList();
  });

  // 카드 클릭 (목록·즐겨찾기 모두) — 부모에 한 번만 걸어두는 방식
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.ticket[data-id]');
    if (card) return goToEvent(card.dataset.id);
    const openBtn = e.target.closest('[data-open]'); // 지도 팝업의 '자세히 보기'
    if (openBtn) return goToEvent(openBtn.dataset.open);
  });

  // 하단 탭
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // 상세 바깥(어두운 부분) 누르면 닫기, ESC 키로 닫기
  $('#detailBackdrop').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#detail').hidden && !document.querySelector('.viewer')) closeDetail();
  });

  window.addEventListener('hashchange', handleHash);
}

// ---------------------------------------------------------
// 13. 서비스 워커 등록 (오프라인 지원 + 홈 화면 설치)
// ---------------------------------------------------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js')
      .catch((err) => console.warn('서비스 워커 등록 실패:', err));
  }
}

// ---------------------------------------------------------
// 14. 앱 시작!
// ---------------------------------------------------------
async function init() {
  loadFavorites();
  bindEvents();
  await loadEvents();
  renderList();
  renderFavorites();
  handleHash(); // 주소에 #event=... 가 있으면 바로 상세 열기 (링크 공유용)
  registerServiceWorker();
}

init();
