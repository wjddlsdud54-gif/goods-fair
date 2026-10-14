/* =========================================================
   community.js — 커뮤니티 화면 (행사 이야기)
   - 행사마다 게시판: 1일차 인증 / 후기 / 작가 칭찬 / 행사 평가
   - 구글 로그인 + 닉네임, 관람 인증 배지, 좋아요·댓글·신고·차단
   서버와 주고받는 일은 community-backend-*.js 가 해요.
   app.js 의 state, esc, fmtShort, getStatus 등을 함께 써요.
   ========================================================= */
import { firebaseConfig } from './firebase-config.js';

const TYPES = {
  day:    { label: '1일차 인증', icon: '📸', cls: 't-day' },
  review: { label: '후기',       icon: '✍️', cls: 't-rev' },
  artist: { label: '작가 칭찬',  icon: '💐', cls: 't-art' },
  rating: { label: '행사 평가',  icon: '⭐', cls: 't-q' }
};
const RATE = [
  ['flow', '🚶 동선'], ['queue', '⏳ 대기줄'], ['goods', '🛍 굿즈·부스'], ['facility', '🏢 시설'], ['staff', '🙋 스태프']
];
const KEYWORDS = {
  good: ['부스 다양해요', '넓어요', '쾌적해요', '스태프 친절해요', '입장 빨라요'],
  bad: ['대기줄 길어요', '물품보관 줄 길어요', '덥거나 추워요', '동선 복잡해요', '매진 빨라요']
};

let api = null;              // 서버 (Firebase 또는 미리보기)
let auth = { signedIn: false, profile: null };
let blocked = new Set();
let board = { ev: null, type: 'all', posts: [], liked: new Set() };

const $c = (s, el = document) => el.querySelector(s);
const $$c = (s, el = document) => [...el.querySelectorAll(s)];
const findEvent = (id) => state.events.find((e) => e.id === id);

// ---------------------------------------------------------
// 1. 시작: 서버 고르기
// ---------------------------------------------------------
async function start() {
  const demo = new URLSearchParams(location.search).get('demo') === 'community';
  try {
    if (demo) {
      api = (await import('./community-backend-demo.js')).createDemoBackend();
    } else if (firebaseConfig) {
      api = await (await import('./community-backend-firebase.js')).createFirebaseBackend(firebaseConfig);
    }
  } catch (e) {
    console.warn('커뮤니티 서버 연결 실패', e);
    api = null;
  }
  if (api) {
    api.onAuth(async (a) => {
      auth = a;
      blocked = await api.blockedList().catch(() => new Set());
      renderCommunityTab();
      if (board.ev) loadBoard();
    });
  }
  renderCommunityTab();
  bindGlobal();
}

// ---------------------------------------------------------
// 2. 커뮤니티 탭: 행사 고르기
// ---------------------------------------------------------
async function renderCommunityTab() {
  const box = $c('#communityList');
  if (!box) return;
  const head = $c('#communityAuth');
  if (!api) {
    head.innerHTML = '';
    box.innerHTML = `<div class="comm-empty">
      <b>커뮤니티 준비 중이에요</b>
      <p>곧 행사별로 1일차 인증, 후기, 작가 칭찬, 행사 평가를 나눌 수 있어요.</p></div>`;
    return;
  }
  head.innerHTML = authChip();
  // 진행 중 → 다가오는(30일 안) → 최근 끝난(30일 안)
  const t = today();
  const near = state.events.filter((ev) => !ev._archived).filter((ev) => {
    const s = parseDate(ev.startDate), e = parseDate(ev.endDate);
    return (s - t) / 864e5 <= 30 && (t - e) / 864e5 <= 30;
  });
  const list = sortEvents(near);
  box.innerHTML = list.map((ev) => `
    <button class="comm-ev ${toneFor(ev)} is-${getStatus(ev)}" data-board="${esc(ev.id)}">
      <span class="comm-ev-st">${stubText(ev)}</span>
      <span class="comm-ev-body"><b>${esc(ev.name)}</b><small>${fmtShortRange(ev)} · ${esc(ev.venue)}</small></span>
      <span class="comm-ev-n" data-count="${esc(ev.id)}">글 보기</span>
    </button>`).join('') || '<p class="empty">가까운 행사가 없어요.</p>';
  const counts = await api.countPosts(list.map((e) => e.id)).catch(() => ({}));
  Object.entries(counts).forEach(([id, n]) => { const el = $c(`[data-count="${CSS.escape(id)}"]`, box); if (el) el.textContent = `글 ${n}개`; });
  if (api.demo) box.insertAdjacentHTML('afterbegin', '<p class="comm-demo">미리보기 모드예요. 여기서 쓴 글은 이 기기에만 잠깐 저장되고 다른 사람에게 보이지 않아요.</p>');
}

function authChip() {
  if (!auth.signedIn) return `<button class="comm-login" data-act="login">로그인하고 글쓰기</button>`;
  if (!auth.profile) return `<button class="comm-login" data-act="nickname">닉네임 정하기</button>`;
  return `<span class="comm-me"><b>${esc(auth.profile.nickname)}</b>님
    <button class="linkish" data-act="account">계정</button></span>`;
}

// ---------------------------------------------------------
// 3. 행사 게시판
// ---------------------------------------------------------
function openBoard(evId, type = 'all') {
  const ev = findEvent(evId);
  if (!ev || !api) return;
  board = { ev, type, posts: [], liked: new Set() };
  const el = $c('#commBoard');
  el.innerHTML = `
    <div class="cb-top">
      <button class="cb-back" data-act="close-board">← 닫기</button>
      <div class="cb-ev ${toneFor(ev)} is-${getStatus(ev)}"><span class="comm-ev-st">${stubText(ev)}</span>
        <span><b>${esc(ev.name)}</b><small>${fmtShortRange(ev)} · ${esc(ev.venue)}</small></span></div>
      <h2 class="cb-title"><span class="mk">행사 이야기</span></h2>
    </div>
    <div class="cb-tabs" role="tablist">
      <button class="cb-tab" data-type="all">전체</button>
      ${Object.entries(TYPES).map(([k, t]) => `<button class="cb-tab" data-type="${k}">${t.icon} ${t.label}</button>`).join('')}
    </div>
    <div id="cbSummary"></div>
    <div class="cb-list" id="cbList"><p class="empty">불러오는 중…</p></div>
    <button class="cb-fab" data-act="write">＋ 글쓰기</button>`;
  el.hidden = false;
  document.body.classList.add('no-scroll');
  setTab(type);
}

function closeBoard() {
  $c('#commBoard').hidden = true;
  board.ev = null;
  if ($c('#detail').hidden) document.body.classList.remove('no-scroll');
}

function setTab(type) {
  board.type = type;
  $$c('.cb-tab').forEach((b) => { b.classList.toggle('is-on', b.dataset.type === type); b.setAttribute('aria-selected', b.dataset.type === type); });
  loadBoard();
}

async function loadBoard() {
  const list = $c('#cbList');
  if (!list || !board.ev) return;
  try {
    // 평가 요약은 '전체'·'행사 평가' 탭에서 보여줘요
    const all = await api.listPosts(board.ev.id, board.type === 'all' || board.type === 'rating' ? 'all' : board.type);
    const visible = all.filter((p) => !blocked.has(p.uid));
    board.posts = board.type === 'all' || board.type !== 'rating' ? visible : visible.filter((p) => p.type === 'rating');
    if (board.type === 'rating') board.posts = visible.filter((p) => p.type === 'rating');
    board.liked = await api.myLikes(board.posts.map((p) => p.id)).catch(() => new Set());
    $c('#cbSummary').innerHTML = (board.type === 'all' || board.type === 'rating') ? summaryHTML(visible.filter((p) => p.type === 'rating')) : '';
    list.innerHTML = board.posts.length
      ? board.posts.map(postHTML).join('')
      : `<div class="comm-empty"><b>아직 글이 없어요</b><p>첫 번째로 ${board.type === 'all' ? '이야기' : TYPES[board.type].label}를 남겨보세요.</p></div>`;
  } catch (e) {
    console.error(e);
    list.innerHTML = '<div class="comm-empty"><b>글을 불러오지 못했어요</b><p>인터넷 연결을 확인하고 다시 열어주세요.</p></div>';
  }
}

// 행사 평가 요약: 관람 인증한 사람의 평가만 평균에 넣어요
function summaryHTML(ratingPosts) {
  const ok = ratingPosts.filter((p) => p.verified && p.ratings);
  if (!ok.length) return board.type === 'rating' ? '<p class="cb-note">관람 인증한 사람의 평가가 모이면 여기에 평균 점수가 보여요.</p>' : '';
  const avg = (k) => ok.reduce((s, p) => s + (p.ratings[k] || 0), 0) / ok.length;
  const total = RATE.reduce((s, [k]) => s + avg(k), 0) / RATE.length;
  const kw = {};
  ok.forEach((p) => (p.keywords || []).forEach((w) => { kw[w] = (kw[w] || 0) + 1; }));
  const kwHTML = Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([w, n]) => `<span class="${KEYWORDS.bad.includes(w) ? 'bad' : 'good'}">${KEYWORDS.bad.includes(w) ? '👎' : '👍'} ${esc(w)} ${n}</span>`).join('');
  return `<div class="cb-score">
    <div class="cb-big"><b>${total.toFixed(1)}</b><span><i class="stars">${stars(Math.round(total))}</i>관람 인증 ${ok.length}명의 평가</span></div>
    ${RATE.map(([k, l]) => `<div class="cb-row"><span>${l}</span><span class="cb-bar"><i style="width:${avg(k) / 5 * 100}%"></i></span><b>${avg(k).toFixed(1)}</b></div>`).join('')}
    ${kwHTML ? `<div class="cb-kw">${kwHTML}</div>` : ''}
  </div>`;
}

const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 6e4);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}
const avatarColor = (s) => ['#5BB8F0', '#FF5FA2', '#8B5CF6', '#E8892B', '#12A5A5', '#3D6BFF'][[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];

function postHTML(p) {
  const t = TYPES[p.type] || TYPES.review;
  const mine = auth.profile && p.uid === auth.profile.uid;
  const booth = p.boothCode ? (() => {
    const info = findBooth(board.ev, p.boothCode);
    return `<button class="cp-booth" data-booth-go="${esc(p.boothCode)}"><b>${esc(p.boothCode)}</b> ${esc(info ? (info.b.name || info.g.name) : '부스')} · 배치도에서 보기</button>`;
  })() : '';
  const rating = p.type === 'rating' && p.ratings
    ? `<p class="cp-rate">${RATE.map(([k, l]) => `${l.split(' ')[1]} ${'★'.repeat(p.ratings[k] || 0)}`).join(' · ')}</p>` : '';
  return `<article class="cp" data-post="${esc(p.id)}">
    <div class="cp-meta">
      <span class="cp-av" style="background:${avatarColor(p.nickname)}">${esc(String(p.nickname).slice(0, 1))}</span>
      <b class="cp-nick">${esc(p.nickname)}</b>
      ${p.verified ? '<span class="cp-badge">✓ 관람 인증</span>' : ''}
      <span class="cp-time">${ago(p.createdAt)}</span>
    </div>
    <span class="cp-type ${t.cls}">${t.label}</span>
    ${rating}
    <p class="cp-text">${esc(p.text)}</p>
    ${p.photos?.length ? `<div class="cp-photos">${p.photos.map((u) => `<img src="${esc(u)}" alt="첨부 사진" loading="lazy" data-photo="${esc(u)}" />`).join('')}</div>` : ''}
    ${booth}
    <div class="cp-acts">
      <button data-like="${esc(p.id)}" aria-pressed="${board.liked.has(p.id)}">${board.liked.has(p.id) ? '♥' : '♡'} <span>${p.likeCount || 0}</span></button>
      <button data-comments="${esc(p.id)}">💬 ${p.commentCount || 0}</button>
      <button class="cp-more" data-more="${esc(p.id)}" data-mine="${mine ? 1 : 0}" data-uid="${esc(p.uid)}" aria-label="더보기">⋯</button>
    </div>
  </article>`;
}

// ---------------------------------------------------------
// 4. 작은 창(모달): 로그인·닉네임·글쓰기·댓글·메뉴
// ---------------------------------------------------------
function modal(html, onReady) {
  const m = $c('#commModal');
  m.innerHTML = `<div class="cm-card" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  onReady && onReady($c('.cm-card', m));
  const f = $c('input, textarea, button', m); f && f.focus();
}
function closeModal() { $c('#commModal').hidden = true; $c('#commModal').innerHTML = ''; }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'comm-toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}

// 로그인이 필요한 행동 전에: 로그인 → 닉네임까지 마쳤는지 확인
async function needAccount() {
  if (!api) return false;
  if (!auth.signedIn) { openLogin(); return false; }
  if (!auth.profile) { openNickname(); return false; }
  if (auth.profile.banned) { toast('이용이 제한된 계정이에요.'); return false; }
  return true;
}

function openLogin() {
  modal(`
    <h3 class="cm-h"><span class="mk">커뮤니티 시작하기</span></h3>
    <p class="cm-p">찜·체크리스트는 로그인 없이 그대로 쓸 수 있어요. 글쓰기·댓글·좋아요만 로그인이 필요해요.</p>
    <label class="cm-check"><input type="checkbox" id="agree14" /> 만 14세 이상이에요</label>
    <label class="cm-check"><input type="checkbox" id="agreeTerms" /> <span><a href="terms.html" target="_blank">이용약관</a>과 <a href="privacy.html" target="_blank">개인정보처리방침</a>에 동의해요</span></label>
    <button class="cm-btn google" id="googleBtn" disabled>Google로 시작하기</button>
    <p class="cm-note">카카오 로그인은 준비 중이에요.</p>
    <button class="cm-cancel" data-act="close-modal">나중에 할게요</button>`, (card) => {
    const a = $c('#agree14', card), b = $c('#agreeTerms', card), g = $c('#googleBtn', card);
    const upd = () => { g.disabled = !(a.checked && b.checked); };
    a.onchange = upd; b.onchange = upd;
    g.onclick = async () => {
      g.disabled = true; g.textContent = '로그인 중…';
      try { await api.signInGoogle(); closeModal(); setTimeout(() => { if (auth.signedIn && !auth.profile) openNickname(); }, 300); }
      catch (e) { g.disabled = false; g.textContent = 'Google로 시작하기'; toast('로그인하지 못했어요. 다시 시도해주세요.'); }
    };
  });
}

function openNickname() {
  modal(`
    <h3 class="cm-h"><span class="mk">닉네임 정하기</span></h3>
    <p class="cm-p">다른 사람에게는 닉네임만 보여요. 2~12자, 한글·영어·숫자만 쓸 수 있어요.</p>
    <input class="cm-input" id="nickIn" maxlength="12" placeholder="예: 별사탕수집가" autocomplete="off" />
    <p class="cm-err" id="nickErr" role="alert"></p>
    <button class="cm-btn primary" id="nickBtn">이 닉네임으로 시작하기</button>
    <button class="cm-cancel" data-act="close-modal">취소</button>`, (card) => {
    const inp = $c('#nickIn', card), err = $c('#nickErr', card), btn = $c('#nickBtn', card);
    btn.onclick = async () => {
      const v = inp.value.trim();
      if (!/^[가-힣a-zA-Z0-9]{2,12}$/.test(v)) { err.textContent = '2~12자의 한글·영어·숫자로 정해주세요.'; return; }
      btn.disabled = true;
      try { await api.claimNickname(v); closeModal(); toast(`${v}님, 환영해요!`); }
      catch (e) { err.textContent = e.message || '저장하지 못했어요.'; btn.disabled = false; }
    };
  });
}

function openAccount() {
  modal(`
    <h3 class="cm-h"><span class="mk">내 계정</span></h3>
    <p class="cm-p">닉네임: <b>${esc(auth.profile?.nickname || '')}</b></p>
    <button class="cm-btn" id="outBtn">로그아웃</button>
    <button class="cm-btn danger" id="delBtn">회원 탈퇴</button>
    <p class="cm-note">탈퇴하면 내가 쓴 글과 닉네임이 지워지고 되돌릴 수 없어요.</p>
    <button class="cm-cancel" data-act="close-modal">닫기</button>`, (card) => {
    $c('#outBtn', card).onclick = async () => { await api.signOut(); closeModal(); toast('로그아웃했어요.'); };
    $c('#delBtn', card).onclick = async (e) => {
      if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = '한 번 더 누르면 탈퇴돼요'; return; }
      e.target.disabled = true;
      try { await api.deleteAccount(); closeModal(); toast('탈퇴했어요. 그동안 고마웠어요.'); }
      catch (err) { e.target.disabled = false; toast('탈퇴하지 못했어요. 다시 시도해주세요.'); }
    };
  });
}

// 관람 인증 가능 기간: 행사 첫날부터 끝난 뒤 3일까지
function canVerify(ev) {
  const t = today();
  return t >= parseDate(ev.startDate) && (t - parseDate(ev.endDate)) / 864e5 <= 3;
}

async function openWrite() {
  if (!(await needAccount())) return;
  const ev = board.ev;
  const verified = await api.isVerified(ev.id).catch(() => false);
  const booths = (ev.boothMap?.groups || []).flatMap((g) => (g.booths || []).map((b) => ({ code: b.code, name: b.name || g.name })));
  let type = board.type !== 'all' ? board.type : (getStatus(ev) === 'ongoing' ? 'day' : 'review');
  let files = [];
  let ratings = { flow: 0, queue: 0, goods: 0, facility: 0, staff: 0 };
  let kws = new Set();
  let boothCode = '';

  modal(`
    <h3 class="cm-h"><span class="mk">글쓰기</span></h3>
    <p class="cm-p">${esc(ev.name)}</p>
    <b class="cm-l">어떤 글인가요?</b>
    <div class="cm-types">${Object.entries(TYPES).map(([k, t]) => `<button data-wtype="${k}">${t.icon} ${t.label}</button>`).join('')}</div>
    <div id="wBooth" hidden>
      <b class="cm-l">칭찬할 부스</b>
      ${booths.length
        ? `<input class="cm-input" id="boothFind" placeholder="부스 번호나 이름으로 찾기" autocomplete="off" /><div class="cm-booths" id="boothOpts"></div>`
        : `<input class="cm-input" id="boothFree" maxlength="12" placeholder="부스 번호 (예: A-12)" />`}
    </div>
    <div id="wRate" hidden>
      <b class="cm-l">별점</b>
      ${RATE.map(([k, l]) => `<div class="cm-rate"><span>${l}</span><span class="cm-stars" data-rate="${k}">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${l} ${n}점">☆</button>`).join('')}</span></div>`).join('')}
      <b class="cm-l">키워드 (여러 개)</b>
      <div class="cm-kws">${[...KEYWORDS.good, ...KEYWORDS.bad].map((w) => `<button data-kw="${esc(w)}" class="${KEYWORDS.bad.includes(w) ? 'bad' : 'good'}">${esc(w)}</button>`).join('')}</div>
    </div>
    <b class="cm-l">내용</b>
    <textarea class="cm-input cm-text" id="wText" maxlength="2000" rows="4" placeholder="어떤 점이 좋았는지, 다른 사람에게 도움이 될 이야기를 적어주세요."></textarea>
    ${api.photos ? `<b class="cm-l">사진 (최대 4장)</b>
    <div class="cm-photos" id="wPhotos"><label class="cm-add">＋<input type="file" accept="image/*" multiple hidden id="wFile" /></label></div>` : ''}
    <div class="cm-verify ${verified ? 'ok' : ''}" id="wVerify" ${api.photos || verified ? '' : 'hidden'}>
      ${verified ? '<b>✓ 관람 인증 완료</b> — 이 행사 글에 인증 배지가 붙어요.'
        : canVerify(ev) ? '<b>관람 인증하기</b> — 입장 팔찌나 티켓 사진을 올리면 글에 ✓ 배지가 붙고, 행사 평가 점수에 반영돼요. <label class="linkish">사진 고르기<input type="file" accept="image/*" hidden id="vFile" /></label>'
        : '관람 인증은 행사 첫날부터 끝난 뒤 3일까지 할 수 있어요.'}
    </div>
    <p class="cm-rule">· 작가·참가자를 깎아내리는 글, 남의 개인정보, 허락 없이 찍은 사람 사진은 올릴 수 없어요.<br>· 작가에 대한 아쉬운 점 대신, 행사 운영은 '행사 평가'로 남겨주세요.</p>
    <p class="cm-err" id="wErr" role="alert"></p>
    <button class="cm-btn primary" id="wSubmit">올리기</button>
    <button class="cm-cancel" data-act="close-modal">취소</button>`, (card) => {
    const setType = (k) => {
      type = k;
      $$c('[data-wtype]', card).forEach((b) => b.classList.toggle('is-on', b.dataset.wtype === k));
      $c('#wBooth', card).hidden = k !== 'artist';
      $c('#wRate', card).hidden = k !== 'rating';
    };
    $$c('[data-wtype]', card).forEach((b) => { b.onclick = () => setType(b.dataset.wtype); });
    setType(type);

    // 부스 고르기
    const opts = $c('#boothOpts', card);
    const renderOpts = (q = '') => {
      const n = q.toLowerCase().replace(/[\s-]/g, '');
      const hit = booths.filter((b) => !n || (b.code + b.name).toLowerCase().replace(/[\s-]/g, '').includes(n)).slice(0, 8);
      opts.innerHTML = hit.map((b) => `<button data-pick="${esc(b.code)}" class="${b.code === boothCode ? 'is-on' : ''}"><b>${esc(b.code)}</b> ${esc(b.name)}</button>`).join('') || '<p class="cm-note">찾는 부스가 없어요.</p>';
      $$c('[data-pick]', opts).forEach((x) => { x.onclick = () => { boothCode = x.dataset.pick; renderOpts($c('#boothFind', card).value); }; });
    };
    if (opts) { renderOpts(); $c('#boothFind', card).oninput = (e) => renderOpts(e.target.value); }

    // 별점·키워드
    $$c('[data-rate]', card).forEach((row) => {
      $$c('[data-star]', row).forEach((s) => {
        s.onclick = () => {
          ratings[row.dataset.rate] = Number(s.dataset.star);
          $$c('[data-star]', row).forEach((x) => { x.textContent = Number(x.dataset.star) <= ratings[row.dataset.rate] ? '★' : '☆'; });
        };
      });
    });
    $$c('[data-kw]', card).forEach((b) => { b.onclick = () => { kws.has(b.dataset.kw) ? kws.delete(b.dataset.kw) : kws.add(b.dataset.kw); b.classList.toggle('is-on'); }; });

    // 사진
    const ph = $c('#wPhotos', card);
    const drawPhotos = () => {
      if (!ph) return;
      $$c('.cm-thumb', ph).forEach((x) => x.remove());
      files.forEach((f, i) => {
        const u = URL.createObjectURL(f);
        ph.insertAdjacentHTML('afterbegin', `<span class="cm-thumb" style="background-image:url('${u}')"><button data-rm="${i}" aria-label="사진 빼기">✕</button></span>`);
      });
      $$c('[data-rm]', ph).forEach((b) => { b.onclick = () => { files.splice(Number(b.dataset.rm), 1); drawPhotos(); }; });
      $c('.cm-add', ph).hidden = files.length >= 4;
    };
    if (ph) $c('#wFile', card).onchange = (e) => { files = [...files, ...e.target.files].slice(0, 4); drawPhotos(); };

    // 관람 인증
    const vf = $c('#vFile', card);
    if (vf) vf.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $c('#wVerify', card).innerHTML = '인증 사진을 올리는 중…';
      try { await api.verify(ev.id, f); $c('#wVerify', card).className = 'cm-verify ok'; $c('#wVerify', card).innerHTML = '<b>✓ 관람 인증 완료</b> — 이 행사 글에 인증 배지가 붙어요.'; }
      catch (err) { $c('#wVerify', card).innerHTML = '인증하지 못했어요. 다시 시도해주세요.'; }
    };

    // 올리기
    $c('#wSubmit', card).onclick = async (e) => {
      const err = $c('#wErr', card);
      const text = $c('#wText', card).value.trim();
      if (type === 'artist') boothCode = boothCode || ($c('#boothFree', card)?.value.trim() || '');
      if (type === 'artist' && !boothCode) { err.textContent = '칭찬할 부스를 골라주세요.'; return; }
      if (type === 'rating' && RATE.some(([k]) => !ratings[k])) { err.textContent = '별점을 모두 매겨주세요.'; return; }
      if (text.length < 5 && type !== 'day') { err.textContent = '내용을 5자 이상 적어주세요.'; return; }
      if (type === 'day' && !text && !files.length) { err.textContent = api.photos ? '사진이나 내용을 남겨주세요.' : '내용을 남겨주세요.'; return; }
      e.target.disabled = true; e.target.textContent = '올리는 중…';
      try {
        await api.createPost({ eventId: ev.id, type, text, boothCode: type === 'artist' ? boothCode : '', ratings: type === 'rating' ? ratings : null, keywords: type === 'rating' ? [...kws] : [] }, files);
        closeModal(); toast('글을 올렸어요.');
        setTab(type);
      } catch (x) {
        console.error(x);
        e.target.disabled = false; e.target.textContent = '올리기'; err.textContent = '올리지 못했어요. 인터넷 연결을 확인해주세요.';
      }
    };
  });
}

async function openComments(postId) {
  modal(`<h3 class="cm-h"><span class="mk">댓글</span></h3><div class="cm-comments" id="cList"><p class="cm-note">불러오는 중…</p></div>
    <div class="cm-cin"><input class="cm-input" id="cIn" maxlength="500" placeholder="댓글 달기" autocomplete="off" /><button class="cm-btn primary" id="cSend">등록</button></div>
    <button class="cm-cancel" data-act="close-modal">닫기</button>`, async (card) => {
    const draw = async () => {
      const list = (await api.listComments(postId)).filter((c) => !blocked.has(c.uid));
      $c('#cList', card).innerHTML = list.length
        ? list.map((c) => `<div class="cm-c"><b>${esc(c.nickname)}</b> <span>${ago(c.createdAt)}</span><p>${esc(c.text)}</p></div>`).join('')
        : '<p class="cm-note">첫 댓글을 남겨보세요.</p>';
    };
    await draw();
    $c('#cSend', card).onclick = async () => {
      if (!(await needAccount())) return;
      const v = $c('#cIn', card).value.trim(); if (!v) return;
      await api.addComment(postId, v); $c('#cIn', card).value = '';
      await draw();
      const p = board.posts.find((x) => x.id === postId); if (p) { p.commentCount = (p.commentCount || 0) + 1; }
      const btn = $c(`[data-comments="${CSS.escape(postId)}"]`); if (btn) btn.textContent = `💬 ${p ? p.commentCount : ''}`;
    };
  });
}

function openMore(btn) {
  const id = btn.dataset.more, mine = btn.dataset.mine === '1', uid = btn.dataset.uid;
  modal(`<h3 class="cm-h"><span class="mk">더보기</span></h3>
    ${mine ? '<button class="cm-btn danger" id="mDel">내 글 삭제</button>' : `
      <button class="cm-btn" id="mRep">신고하기</button>
      <button class="cm-btn" id="mBlock">이 사람 글 안 보기 (차단)</button>`}
    ${api.isAdmin() ? '<button class="cm-btn danger" id="mHide">관리자: 글 숨기기</button>' : ''}
    <button class="cm-cancel" data-act="close-modal">닫기</button>`, (card) => {
    const del = $c('#mDel', card);
    if (del) del.onclick = async () => { await api.deletePost(id); closeModal(); toast('삭제했어요.'); loadBoard(); };
    const rep = $c('#mRep', card);
    if (rep) rep.onclick = () => openReport(id);
    const bl = $c('#mBlock', card);
    if (bl) bl.onclick = async () => { if (!(await needAccount())) return; await api.blockUser(uid); blocked.add(uid); closeModal(); toast('이 사람의 글과 댓글이 더 이상 안 보여요.'); loadBoard(); };
    const hide = $c('#mHide', card);
    if (hide) hide.onclick = async () => { await api.hidePost(id); closeModal(); toast('숨겼어요.'); loadBoard(); };
  });
}

function openReport(postId) {
  const reasons = ['작가·참가자 비방', '욕설·혐오 표현', '개인정보 노출', '허락 없는 사람 사진', '광고·도배', '거짓 정보', '기타'];
  modal(`<h3 class="cm-h"><span class="mk">신고하기</span></h3><p class="cm-p">어떤 문제가 있나요? 운영자가 확인 후 처리해요.</p>
    <div class="cm-reasons">${reasons.map((r) => `<button data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <button class="cm-cancel" data-act="close-modal">취소</button>`, (card) => {
    $$c('[data-reason]', card).forEach((b) => {
      b.onclick = async () => {
        if (!(await needAccount())) return;
        await api.report(postId, b.dataset.reason); closeModal(); toast('신고했어요. 확인 후 처리할게요.');
      };
    });
  });
}

// 작가 칭찬의 부스 → 행사 상세의 배치도에서 위치 보여주기
function goBooth(code) {
  const evId = board.ev.id;
  closeBoard();
  if (location.hash === '#event=' + encodeURIComponent(evId)) openDetail(evId); else goToEvent(evId);
  setTimeout(() => {
    const li = [...document.querySelectorAll('#boothGroups .booth')].find((x) => x.dataset.booth === code);
    if (li && li.dataset.pos) markBooth(li, true);
  }, 600);
}

// ---------------------------------------------------------
// 5. 버튼 연결 (한 곳에서 처리)
// ---------------------------------------------------------
function bindGlobal() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-board],[data-act],[data-type],[data-like],[data-comments],[data-more],[data-booth-go],[data-photo]');
    if (!t) return;
    if (t.dataset.board) { if (!api) { toast('커뮤니티는 준비 중이에요.'); return; } e.preventDefault(); window.openBoard(t.dataset.board); return; }
    if (t.dataset.type && t.classList.contains('cb-tab')) { setTab(t.dataset.type); return; }
    if (t.dataset.boothGo) { goBooth(t.dataset.boothGo); return; }
    if (t.dataset.photo) { openMapViewer(t.dataset.photo, '첨부 사진'); return; }
    if (t.dataset.comments) { openComments(t.dataset.comments); return; }
    if (t.dataset.more) { openMore(t); return; }
    if (t.dataset.like) {
      if (!(await needAccount())) return;
      const r = await api.toggleLike(t.dataset.like);
      r.liked ? board.liked.add(t.dataset.like) : board.liked.delete(t.dataset.like);
      t.setAttribute('aria-pressed', r.liked); t.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.count}</span>`;
      return;
    }
    switch (t.dataset.act) {
      case 'login': openLogin(); break;
      case 'nickname': openNickname(); break;
      case 'account': openAccount(); break;
      case 'close-board': closeBoard(); break;
      case 'close-modal': closeModal(); break;
      case 'write': openWrite(); break;
    }
  });
  $c('#commModal').addEventListener('click', (e) => { if (e.target.id === 'commModal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$c('#commModal').hidden) closeModal();
    else if (!$c('#commBoard').hidden) closeBoard();
  });
}

// 행사 상세 화면의 "행사 이야기" 버튼에서 부를 수 있게
window.openBoard = (id) => {
  if (!api) return;
  if (!$c('#detail').hidden) {
    hideDetail();
    // 주소의 #event=… 를 지워서, 나중에 같은 행사를 다시 열 수 있게
    if (location.hash.startsWith('#event=')) history.replaceState(null, '', location.pathname + location.search);
  }
  openBoard(id);
};
window.renderCommunityTab = renderCommunityTab;
window.communityReady = () => !!api;

start();
