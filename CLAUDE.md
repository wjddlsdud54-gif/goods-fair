# 굿즈행사 캘린더 — Claude 작업 안내

이 파일은 Claude(Claude Code 포함)가 이 저장소에서 이어서 작업할 때 먼저 읽는 안내서예요.

## 사용자
- 코딩 초보예요. **한국어로**, 단계별로 쉽게 설명해주세요. 화면 메뉴 이름을 짐작해서 말하지 말고, 모르면 확인한 뒤 말해주세요.
- 결과는 스크린샷이나 사이트 링크로 보여주면 좋아해요.

## 프로젝트
- 한국 굿즈·일러스트·애니·게임·코스프레·동인 행사 일정을 **티켓 모양 카드**로 보여주는 웹앱(PWA)이에요. 나중에 Google Play 앱(TWA)으로 낼 계획이에요.
- 디자인은 "입장권 × 다꾸 모눈종이" 스타일이에요. 민트 모눈 배경에 마스킹테이프를 쓰고, 색은 `style.css`의 `:root` 변수로 정해요.
- 기술: 순수 HTML/CSS/JS로 만들었고 빌드 과정이 없어요. Leaflet + OpenStreetMap, Pretendard 글꼴을 써요.
- 배포: `main`에 push하면 Netlify가 자동으로 배포해요 → https://magnificent-bubblegum-b46e5d.netlify.app/
- **앱 파일(html/css/js)을 바꾸면 `service-worker.js`의 `CACHE_VERSION`을 하나 올려주세요.** 지금은 v10이에요.

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 뼈대. 탭은 티켓 / 지도 / 찜한 행사 / 커뮤니티 |
| `app.js` | 목록, 필터, 상세, 부스 배치도와 부스 검색, 부스 찜 체크리스트, 관람 안내와 시간표, 오프라인, 아카이브 |
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
- 사용자의 이메일을 공개 파일에 넣지 마세요. privacy/terms의 연락처는 사용자가 알려줄 때까지 `[연락처 이메일을 여기에 적어주세요]` 그대로 둬요.
- commit 메시지는 한국어로 써주세요.

## 테스트
- 로컬 서버: `python3 -m http.server 8766`을 실행하고 `http://localhost:8766/index.html` (`?demo=community`)으로 열어요.
- Playwright로 화면을 확인해요. CDN(unpkg/jsdelivr)이 막힌 환경이면 Leaflet을 가짜 객체(stub)로 바꿔서 테스트해요.

## 다음에 할 일
1. **Firebase 연결**: 사용자가 `FIREBASE_SETUP.md`를 따라 프로젝트를 만들고 firebaseConfig를 보내주면:
   - `firebase-config.js`에 넣고 CACHE_VERSION을 올려요.
   - 실제 서버에서 로그인 → 닉네임 → 글쓰기 → 권한 막힘을 확인해요. 보안 규칙은 아직 에뮬레이터로 테스트하지 못했어요.
   - 사진 기능(Storage)은 Blaze 요금제가 필요해요. 사용자가 원하지 않으면 config에 `photos: false`를 넣어요.
2. privacy.html과 terms.html의 연락처 이메일을 받아서 넣어요.
3. Play 스토어: PWABuilder로 TWA 만들기, 사용자가 주는 `assetlinks.json`을 `.well-known/`에 넣기, 테스터 12명 × 14일 비공개 테스트
4. 나중에: 카카오 로그인 (Firebase 기본 기능이 아니라서 따로 서버 함수가 필요해요)
