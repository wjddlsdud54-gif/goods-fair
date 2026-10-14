/* =========================================================
   community-backend-firebase.js — 커뮤니티 서버(Firebase)와 주고받는 부분
   화면 코드(community.js)는 여기 있는 함수만 불러서 써요.

   데이터 구조 (Firestore)
   users/{uid}                 닉네임, 가입일, 정지 여부
   users/{uid}/blocked/{uid2}  내가 차단한 사람
   nicknames/{닉네임}          닉네임 중복 막기 (주인 uid)
   posts/{postId}              글 (eventId, type, text, boothCode, ratings, keywords, photos, uid, nickname, verified, likeCount, commentCount, hidden, createdAt)
   posts/{id}/likes/{uid}      좋아요
   posts/{id}/comments/{cid}   댓글
   verifications/{eventId_uid} 관람 인증 (사진, 상태)
   reports/{reportId}          신고
   config/admins               관리자 uid 목록 { uids: [...] }
   ========================================================= */
const V = '10.14.1';
const app$ = import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const auth$ = import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const fs$ = import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
const st$ = import(`https://www.gstatic.com/firebasejs/${V}/firebase-storage.js`);

export async function createFirebaseBackend(config) {
  const [A, AU, F, S] = await Promise.all([app$, auth$, fs$, st$]);
  const app = A.initializeApp(config);
  const auth = AU.getAuth(app);
  const db = F.getFirestore(app);
  // 사진(글 사진·관람 인증)은 Storage를 켠 경우에만. firebase-config.js 에서 photos: false 로 끌 수 있어요
  const photosOn = !!config.storageBucket && config.photos !== false;
  const storage = photosOn ? S.getStorage(app) : null;
  let me = null;          // { uid, nickname } 로그인 + 닉네임까지 정한 상태
  let firebaseUser = null; // 구글 로그인만 한 상태 (닉네임 전)
  let adminUids = [];

  const toPost = (d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toMillis?.() || Date.now() });

  async function loadProfile(u) {
    if (!u) return null;
    const snap = await F.getDoc(F.doc(db, 'users', u.uid));
    if (!snap.exists()) return null;
    const p = snap.data();
    if (p.banned) return { uid: u.uid, nickname: p.nickname, banned: true };
    return { uid: u.uid, nickname: p.nickname };
  }

  async function loadAdmins() {
    try {
      const s = await F.getDoc(F.doc(db, 'config', 'admins'));
      adminUids = s.exists() ? (s.data().uids || []) : [];
    } catch (e) { adminUids = []; }
  }

  // 사진 줄이기: 긴 쪽 1280px, JPEG 80% (데이터·저장공간 절약)
  async function shrink(file) {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  }
  async function upload(path, file) {
    const r = S.ref(storage, path);
    await S.uploadBytes(r, await shrink(file), { contentType: 'image/jpeg' });
    return await S.getDownloadURL(r);
  }

  return {
    ready: true,
    photos: photosOn,

    // 로그인 상태가 바뀔 때마다 cb({ signedIn, profile }) 호출
    onAuth(cb) {
      AU.onAuthStateChanged(auth, async (u) => {
        firebaseUser = u;
        me = await loadProfile(u);
        await loadAdmins();
        cb({ signedIn: !!u, profile: me });
      });
    },

    async signInGoogle() {
      const provider = new AU.GoogleAuthProvider();
      try { await AU.signInWithPopup(auth, provider); }
      catch (e) {
        // 앱(TWA) 안처럼 팝업이 막히는 곳에서는 화면 이동 방식으로
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await AU.signInWithRedirect(auth, provider);
        } else throw e;
      }
    },
    async signOut() { await AU.signOut(auth); },

    // 닉네임 정하기 (처음 가입할 때). 이미 쓰는 닉네임이면 오류
    async claimNickname(nickname) {
      if (!firebaseUser) throw new Error('로그인이 필요해요');
      await F.runTransaction(db, async (tx) => {
        const nRef = F.doc(db, 'nicknames', nickname);
        const n = await tx.get(nRef);
        if (n.exists() && n.data().uid !== firebaseUser.uid) throw new Error('이미 쓰는 닉네임이에요');
        tx.set(nRef, { uid: firebaseUser.uid });
        tx.set(F.doc(db, 'users', firebaseUser.uid), { nickname, createdAt: F.serverTimestamp(), agreedAt: F.serverTimestamp() });
      });
      me = { uid: firebaseUser.uid, nickname };
      return me;
    },

    isAdmin() { return !!me && adminUids.includes(me.uid); },

    // 행사별 글 목록 (최신순, 최대 100개). type: 'all' | 'day' | 'review' | 'artist' | 'rating'
    async listPosts(eventId, type = 'all') {
      const parts = [F.collection(db, 'posts'), F.where('eventId', '==', eventId), F.where('hidden', '==', false)];
      if (type !== 'all') parts.push(F.where('type', '==', type));
      parts.push(F.orderBy('createdAt', 'desc'), F.limit(100));
      const snap = await F.getDocs(F.query(...parts));
      return snap.docs.map(toPost);
    },

    // 여러 행사의 글 수 (커뮤니티 탭 목록용)
    async countPosts(eventIds) {
      const out = {};
      await Promise.all(eventIds.map(async (id) => {
        try {
          const q = F.query(F.collection(db, 'posts'), F.where('eventId', '==', id), F.where('hidden', '==', false));
          out[id] = (await F.getCountFromServer(q)).data().count;
        } catch (e) { out[id] = 0; }
      }));
      return out;
    },

    async createPost(data, files = []) {
      if (!me) throw new Error('로그인이 필요해요');
      const ref = F.doc(F.collection(db, 'posts'));
      const photos = [];
      for (let i = 0; photosOn && i < Math.min(4, files.length); i++) {
        photos.push(await upload(`posts/${me.uid}/${ref.id}/${i}.jpg`, files[i]));
      }
      const verified = await this.isVerified(data.eventId);
      await F.setDoc(ref, {
        eventId: data.eventId, type: data.type, text: String(data.text || '').slice(0, 2000),
        boothCode: data.boothCode || '', ratings: data.ratings || null, keywords: data.keywords || [],
        photos, uid: me.uid, nickname: me.nickname, verified,
        likeCount: 0, commentCount: 0, hidden: false, createdAt: F.serverTimestamp()
      });
      return ref.id;
    },

    async deletePost(postId) {
      const ref = F.doc(db, 'posts', postId);
      const snap = await F.getDoc(ref);
      const photos = snap.exists() ? (snap.data().photos || []) : [];
      await F.deleteDoc(ref);
      if (photosOn) await Promise.all(photos.map((u) => S.deleteObject(S.ref(storage, u)).catch(() => {})));
    },
    async hidePost(postId) { await F.updateDoc(F.doc(db, 'posts', postId), { hidden: true }); },

    async myLikes(postIds) {
      if (!me) return new Set();
      const liked = new Set();
      await Promise.all(postIds.map(async (id) => {
        const s = await F.getDoc(F.doc(db, 'posts', id, 'likes', me.uid));
        if (s.exists()) liked.add(id);
      }));
      return liked;
    },

    async toggleLike(postId) {
      if (!me) throw new Error('로그인이 필요해요');
      const likeRef = F.doc(db, 'posts', postId, 'likes', me.uid);
      const postRef = F.doc(db, 'posts', postId);
      return await F.runTransaction(db, async (tx) => {
        const [l, p] = await Promise.all([tx.get(likeRef), tx.get(postRef)]);
        const count = p.data().likeCount || 0;
        if (l.exists()) { tx.delete(likeRef); tx.update(postRef, { likeCount: count - 1 }); return { liked: false, count: count - 1 }; }
        tx.set(likeRef, { at: F.serverTimestamp() }); tx.update(postRef, { likeCount: count + 1 });
        return { liked: true, count: count + 1 };
      });
    },

    async listComments(postId) {
      const q = F.query(F.collection(db, 'posts', postId, 'comments'), F.orderBy('createdAt', 'asc'), F.limit(200));
      return (await F.getDocs(q)).docs.map(toPost);
    },
    async addComment(postId, text) {
      if (!me) throw new Error('로그인이 필요해요');
      const postRef = F.doc(db, 'posts', postId);
      const cRef = F.doc(F.collection(db, 'posts', postId, 'comments'));
      await F.runTransaction(db, async (tx) => {
        const p = await tx.get(postRef);
        tx.set(cRef, { uid: me.uid, nickname: me.nickname, text: String(text).slice(0, 500), createdAt: F.serverTimestamp() });
        tx.update(postRef, { commentCount: (p.data().commentCount || 0) + 1 });
      });
    },

    async report(postId, reason) {
      if (!me) throw new Error('로그인이 필요해요');
      await F.addDoc(F.collection(db, 'reports'), { postId, reason, uid: me.uid, createdAt: F.serverTimestamp() });
    },

    async blockUser(uid) {
      if (!me) throw new Error('로그인이 필요해요');
      await F.setDoc(F.doc(db, 'users', me.uid, 'blocked', uid), { at: F.serverTimestamp() });
    },
    async blockedList() {
      if (!me) return new Set();
      const s = await F.getDocs(F.collection(db, 'users', me.uid, 'blocked'));
      return new Set(s.docs.map((d) => d.id));
    },

    // 관람 인증: 입장 팔찌·티켓 사진을 올리면 바로 인증 (관리자가 나중에 취소 가능)
    async verify(eventId, file) {
      if (!me) throw new Error('로그인이 필요해요');
      if (!photosOn) throw new Error('사진 기능이 꺼져 있어요');
      const url = await upload(`verifications/${me.uid}/${eventId}.jpg`, file);
      await F.setDoc(F.doc(db, 'verifications', `${eventId}_${me.uid}`), {
        eventId, uid: me.uid, photo: url, status: 'approved', createdAt: F.serverTimestamp()
      });
    },
    async isVerified(eventId) {
      if (!me) return false;
      const s = await F.getDoc(F.doc(db, 'verifications', `${eventId}_${me.uid}`));
      return s.exists() && s.data().status === 'approved';
    },

    // 회원 탈퇴: 내 글·닉네임·프로필 지우고 계정 삭제
    async deleteAccount() {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const mine = await F.getDocs(F.query(F.collection(db, 'posts'), F.where('uid', '==', uid)));
      await Promise.all(mine.docs.map((d) => F.deleteDoc(d.ref)));
      // 다른 사람 글에 단 내 댓글, 관람 인증 기록
      const myComments = await F.getDocs(F.query(F.collectionGroup(db, 'comments'), F.where('uid', '==', uid))).catch(() => ({ docs: [] }));
      await Promise.all(myComments.docs.map((d) => F.deleteDoc(d.ref).catch(() => {})));
      const myVer = await F.getDocs(F.query(F.collection(db, 'verifications'), F.where('uid', '==', uid))).catch(() => ({ docs: [] }));
      await Promise.all(myVer.docs.map((d) => F.deleteDoc(d.ref).catch(() => {})));
      // 올린 사진 파일 (글 사진, 인증 사진)
      const wipe = async (path) => {
        try {
          const res = await S.listAll(S.ref(storage, path));
          await Promise.all(res.items.map((i) => S.deleteObject(i).catch(() => {})));
          await Promise.all(res.prefixes.map((p) => wipe(p.fullPath)));
        } catch (e) { /* 없으면 넘어가요 */ }
      };
      if (photosOn) { await wipe(`posts/${uid}`); await wipe(`verifications/${uid}`); }
      if (me?.nickname) await F.deleteDoc(F.doc(db, 'nicknames', me.nickname)).catch(() => {});
      await F.deleteDoc(F.doc(db, 'users', uid)).catch(() => {});
      try { await AU.deleteUser(firebaseUser); }
      catch (e) {
        // 오래전에 로그인했다면 다시 로그인한 뒤 삭제해야 해요
        if (e.code === 'auth/requires-recent-login') {
          await AU.reauthenticateWithPopup(firebaseUser, new AU.GoogleAuthProvider());
          await AU.deleteUser(auth.currentUser);
        } else throw e;
      }
      me = null;
    }
  };
}
