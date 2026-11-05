# 굿즈행사 캘린더 — Claude 작업 안내

이 파일은 Claude(Claude Code 포함)가 이 저장소에서 이어서 작업할 때 먼저 읽는 안내서예요.

## 사용자
- 코딩 초보예요. **한국어로**, 단계별로 쉽게 설명해주세요. 화면 메뉴 이름을 짐작해서 말하지 말고, 모르면 확인한 뒤 말해주세요.
- 결과는 스크린샷이나 사이트 링크로 보여주면 좋아해요.

## 프로젝트
- 한국 굿즈·일러스트·애니·게임·코스프레·동인 행사 일정을 **티켓 모양 카드**로 보여주는 웹앱(PWA)이에요. 나중에 Google Play 앱(TWA)으로 낼 계획이에요.
- 디자인은 "입장권 × 다꾸 모눈종이" 스타일이에요. 민트 모눈 배경에 마스킹테이프를 쓰고, 색은 `style.css`의 `:root` 변수로 정해요.
- 기술: 순수 HTML/CSS/JS로 만들었고 빌드 과정이 없어요. Leaflet + OpenStreetMap, Pretendard 글꼴을 써요.
- 배포: `main`에 push하면 **Cloudflare Pages**가 자동으로 배포해요 → https://goodsfestival.pages.dev/
  - 2026-10-29에 Netlify에서 옮겼어요 (Netlify 무료 배포 횟수가 모자라서). 캐시 설정은 `_headers` 파일이에요. Netlify는 GitHub 연결을 끊었고 예전 주소는 더 이상 업데이트되지 않아요.
- **앱 파일(html/css/js)을 바꾸면 `service-worker.js`의 `CACHE_VERSION`을 하나 올려주세요.** 지금은 v15예요.

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 뼈대. 탭은 티켓 / 지도 / 찜한 행사 / 커뮤니티 |
| `app.js` | 목록, 필터, 상세, 부스 배치도와 부스 검색, 부스 찜 체크리스트, 관람 안내와 시간표, 오프라인, 아카이브, 설정(화면 모드·글자 크기·알림·시작 화면) |
| `service-worker.js` | 오프라인 저장, 찜한 행사·새 행사 알림 확인(앱을 열 때 + 설치한 앱은 하루 한 번쯤) |
| `community.js` | 커뮤니티 화면(행사 이야기). 서버와 주고받는 부분은 `community-backend-*.js` |
| `community-backend-firebase.js` / `community-backend-demo.js` | 실제 Firebase 서버 / 미리보기용 가짜 서버(`?demo=community`) |
| `firebase-config.js` | **아직 `null`이라서 커뮤니티가 "준비 중"으로 보여요.** 사용자가 config를 주면 여기에 넣어요 |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `FIREBASE_SETUP.md` | Firebase 보안 규칙, 색인, 사용자용 설정 안내 |
| `events.json` | 행사 데이터. 구조와 규칙은 `UPDATE_GUIDE.md`에 있어요 |
| `archive.json` | 끝난 지 60일이 지난 행사 |
| `maps/` | 부스 배치도 그림 |
| `scripts/fetch_booth_maps.py` + `.github/workflows/booth-maps.yml` | `boothMap.imageUrl`에 적힌 배치도 그림을 자동으로 내려받아요 |
| `privacy.html`, `terms.html` | 개인정보처리방침, 이용약관 |
| `PLAY_STORE_GUIDE.md`, `store/`, `manifest.json` | Play 스토어 준비 자료 |

## 자동 업데이트
- 매일 00시(한국 시간)에 예약 작업이 `UPDATE_GUIDE.md`를 따라 `events.json`을 갱신하고 commit해요. 그래서 작업 전에 항상 `git pull`부터 해주세요.
- 부스 배치도를 자동으로 가져올 수 없는 사이트는 사용자에게 알려서 사진을 받아요.

## 꼭 지킬 것
- 자동 수집을 막는 사이트(robots.txt 등)는 **우회하지 말고**, 사용자에게 보고해주세요.
- 출처가 있는 공식 정보만 써주세요. 행사 정보를 지어내지 말고, 다른 서비스의 글이나 그림을 베끼지 마세요.
- 사용자의 개인 이메일을 공개 파일에 넣지 마세요. 공개 연락처는 사용자가 정한 앱 전용 메일 **goodsfestival@gmail.com** 만 써요 (privacy/terms에 넣었어요).
- commit 메시지는 한국어로 써주세요.

## 테스트
- 로컬 서버: `python3 -m http.server 8766`을 실행하고 `http://localhost:8766/index.html` (`?demo=community`)으로 열어요.
- Playwright로 화면을 확인해요. CDN(unpkg/jsdelivr)이 막힌 환경이면 Leaflet을 가짜 객체(stub)로 바꿔서 테스트해요.

## 다음에 할 일
1. **Firebase 연결**: 사용자가 `FIREBASE_SETUP.md`를 따라 프로젝트를 만들고 firebaseConfig를 보내주면:
   - `firebase-config.js`에 넣고 CACHE_VERSION을 올려요.
   - 실제 서버에서 로그인 → 닉네임 → 글쓰기 → 권한 막힘을 확인해요. 보안 규칙은 아직 에뮬레이터로 테스트하지 못했어요.
   - 사진 기능(Storage)은 Blaze 요금제가 필요해요. 사용자가 원하지 않으면 config에 `photos: false`를 넣어요.
   - **커뮤니티를 켜면 Play Console도 고쳐야 해요**: 앱 콘텐츠 → 로그인 세부정보(예전 이름 "앱 액세스")를 "아니요" → "예"로 바꾸고 심사용 테스트 구글 계정을 적기, 데이터 보안 양식에 이메일·사용자 ID·사진·사용자 제작 콘텐츠 수집을 추가하기, 콘텐츠 등급 설문을 다시 해서 "사용자 컨텐츠 공유 = 예"로 바꾸기. (2026-11-05에는 커뮤니티가 꺼져 있어서 "아니요"로 냈어요)
2. Play 스토어 (개발자 계정 Goods Festival, 패키지 이름 `com.goodsfestival.calendar`, 홈 화면 이름 굿즈페스티벌, 앱 설정 12개 완료 2026-11-05): PWABuilder로 TWA 만들기 ✅, `.well-known/assetlinks.json` ✅ (2026-11-05, PWABuilder 서명 키 지문만 들어 있어요). **Play Console에 .aab를 올린 뒤 "앱 무결성 → 앱 서명"의 SHA-256 지문을 받아서 같은 파일 배열에 추가해야 해요** (안 하면 앱 위쪽에 주소창이 보여요). 그다음 테스터 12명 × 14일 비공개 테스트
3. **광고를 넣으면** Play Console → 앱 콘텐츠 → 광고를 "아니요" → "예"로 바꿔요. (2026-11-05에는 광고가 없어서 "아니요"로 냈어요)
4. 나중에: 카카오 로그인 (Firebase 기본 기능이 아니라서 따로 서버 함수가 필요해요)
