/* =========================================================
   community-backend-demo.js — 미리보기용 가짜 서버
   주소 끝에 ?demo=community 를 붙이면 Firebase 없이 커뮤니티 화면을 써볼 수 있어요.
   글은 이 기기 안에서만 잠깐 저장되고, 다른 사람에게 보이지 않아요.
   (Firebase 버전과 똑같은 함수 이름을 가지고 있어요)
   ========================================================= */
export function createDemoBackend() {
  const KEY = 'goodsfair.demoCommunity';
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const now = Date.now();
  const seed = () => ({
    me: null, signedIn: false, verified: {}, blocked: [], likes: {},
    posts: [
      { id: 'd1', eventId: '*', type: 'day', text: '[예시 글] 오픈런 성공! 10시 기준 입장 줄 3열이었어요. 팔찌 교환이 빨라요.', photos: [], uid: 'u1', nickname: '예시닉네임1', verified: true, likeCount: 24, commentCount: 1, createdAt: now - 6e5, boothCode: '', keywords: [] },
      { id: 'd2', eventId: '*', type: 'rating', text: '[예시 글] 홀이 넓어서 덜 붐볐어요. 물품보관소는 오후에 줄이 길어요.', ratings: { flow: 4, queue: 3, goods: 5, facility: 4, staff: 4 }, keywords: ['부스 다양해요', '물품보관 줄 길어요'], photos: [], uid: 'u2', nickname: '예시닉네임2', verified: true, likeCount: 12, commentCount: 0, createdAt: now - 36e5, boothCode: '' },
      { id: 'd3', eventId: '*', type: 'review', text: '[예시 글] 처음 가봤는데 생각보다 쾌적했어요. 다음에도 갈래요!', photos: [], uid: 'u3', nickname: '예시닉네임3', verified: false, likeCount: 3, commentCount: 0, createdAt: now - 72e5, boothCode: '', keywords: [] }
    ],
    comments: { d1: [{ id: 'c1', uid: 'u2', nickname: '예시닉네임2', text: '[예시 댓글] 정보 감사해요!', createdAt: now - 3e5 }] }
  });
  let s = load() || seed();
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 저장 안 돼도 메모리로 */ } };
  const listeners = [];
  const emit = () => listeners.forEach((cb) => cb({ signedIn: s.signedIn, profile: s.me }));
  const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const fileToUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });

  return {
    ready: true,
    demo: true,
    photos: true,
    onAuth(cb) { listeners.push(cb); setTimeout(() => cb({ signedIn: s.signedIn, profile: s.me }), 0); },
    async signInGoogle() { await wait(); s.signedIn = true; save(); emit(); },
    async signOut() { s.signedIn = false; s.me = null; save(); emit(); },
    async claimNickname(nickname) {
      await wait();
      if (s.posts.some((p) => p.nickname === nickname && p.uid !== 'me')) throw new Error('이미 쓰는 닉네임이에요');
      s.me = { uid: 'me', nickname }; save(); emit(); return s.me;
    },
    isAdmin() { return false; },
    async listPosts(eventId, type = 'all') {
      await wait();
      return s.posts
        .filter((p) => (p.eventId === eventId || p.eventId === '*') && !p.hidden && (type === 'all' || p.type === type))
        .map((p) => ({ ...p, eventId }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async countPosts(ids) { const o = {}; ids.forEach((id) => { o[id] = s.posts.filter((p) => p.eventId === id || p.eventId === '*').length; }); return o; },
    async createPost(data, files = []) {
      await wait(300);
      const photos = [];
      for (const f of files.slice(0, 4)) photos.push(await fileToUrl(f));
      const id = 'p' + Date.now();
      s.posts.push({ id, ...data, photos, uid: 'me', nickname: s.me.nickname, verified: !!s.verified[data.eventId], likeCount: 0, commentCount: 0, createdAt: Date.now() });
      save(); return id;
    },
    async deletePost(id) { s.posts = s.posts.filter((p) => p.id !== id); save(); },
    async hidePost(id) { const p = s.posts.find((x) => x.id === id); if (p) p.hidden = true; save(); },
    async myLikes() { return new Set(Object.keys(s.likes)); },
    async toggleLike(id) {
      const p = s.posts.find((x) => x.id === id);
      if (s.likes[id]) { delete s.likes[id]; p.likeCount--; } else { s.likes[id] = 1; p.likeCount++; }
      save(); return { liked: !!s.likes[id], count: p.likeCount };
    },
    async listComments(id) { await wait(); return s.comments[id] || []; },
    async addComment(id, text) {
      (s.comments[id] = s.comments[id] || []).push({ id: 'c' + Date.now(), uid: 'me', nickname: s.me.nickname, text, createdAt: Date.now() });
      s.posts.find((x) => x.id === id).commentCount++; save();
    },
    async report() { await wait(); },
    async blockUser(uid) { s.blocked.push(uid); save(); },
    async blockedList() { return new Set(s.blocked); },
    async verify(eventId) { await wait(300); s.verified[eventId] = true; save(); },
    async isVerified(eventId) { return !!s.verified[eventId]; },
    async deleteAccount() { s = seed(); save(); emit(); }
  };
}
