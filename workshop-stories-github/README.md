# 망한 수업 자랑하기

**사연 올리기**에서 수업 경험을 제출하고, **사연 모아보기**에서 읽고 하트로 공감하는 교원 연수 웹앱입니다.

## GitHub → Vercel 배포

자세한 순서는 [DEPLOYMENT.md](./DEPLOYMENT.md)에 있습니다.

1. 이 폴더의 소스를 GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 Import합니다. package.json과 server.mjs가 있는 폴더를 Root Directory로 선택합니다. Node.js는 24.x, 빌드/출력 경로는 자동 설정을 유지합니다.
3. Supabase 프로젝트의 Connect → Transaction pooler에서 URI를 복사해 Vercel 서버 환경 변수 **DATABASE_URL**에 설정합니다.
4. 환경 변수 연결 후 Redeploy합니다. 최초 DB 요청 시 두 테이블과 인덱스가 자동으로 만들어집니다.

배포 후 사연과 하트는 **Supabase 서버의 PostgreSQL DB**에 저장됩니다. Vercel 재배포나 함수 재시작과 별개로 보존됩니다. DB가 연결되지 않은 Vercel 환경에서는 저장하지 않습니다. 실제 GitHub 업로드, Supabase 계정/DB 생성, Vercel 공개 배포는 아직 수행하지 않았습니다.

## 로컬 실행

Windows에서는 `실행하기.cmd`를 더블클릭합니다. Node.js 24.x가 필요하며, 이 컴퓨터에서는 Codex 번들 Node도 자동으로 찾습니다.

- 사연 모아보기: http://localhost:4977
- 사연 올리기: http://localhost:4977/join
- 터미널 실행: `node server.mjs`
- 새 컴퓨터에서 처음 실행: `npm install` 또는 `pnpm install`

로컬에서는 DB 환경 변수가 없으면 기존 `data/stories.sqlite`에 저장합니다. 기존 사연을 삭제하거나 자동으로 클라우드에 업로드하지 않습니다. 클라우드 DB를 로컬에서도 쓰려면 `.env.example`을 `.env.local`로 복사하고 실제 연결 문자열을 입력한 다음 서버를 재시작하세요. `.env.local`은 Git에서 제외됩니다.

## 기능

- 모든 참가자가 두 탭에 접근; 닉네임으로 참여
- 닉네임 20자, 수업 의도/실제 내용 각각 200자
- 초안은 현재 브라우저에 자동 저장, 제출한 사연은 서버에 저장
- 하트 추가/취소, 사연별 브라우저당 하나; 중복 요청에도 중복 집계 방지
- 3초 간격 갱신, 최신순/공감순 정렬, 닉네임/본문 검색
- 사연 확대, 이전/다음 사연, QR 확대 및 링크 복사
- 모바일 화면, 실제 접수 건수에서 제외되는 예시 미리보기
- 작성한 브라우저에서 본인 사연 수정·삭제
- 화면 하단 관리자 로그인(기본 비밀번호 `0000`) 후 모든 사연 수정·삭제

쿠키를 삭제하거나 다른 브라우저를 사용하면 별도 참가자로 인식합니다. 사연은 접속한 참가자에게 공개됩니다. 본인 사연은 작성 당시 브라우저 쿠키로 확인합니다. 쿠키를 삭제했다면 관리자가 수정·삭제할 수 있습니다. 현재는 하나의 공유 공간이며 행사별 방 분리는 포함하지 않습니다.

## 환경 변수

| 이름 | 용도 |
|---|---|
| DATABASE_URL | Supabase PostgreSQL 연결 문자열. Vercel 배포 시 필요 |
| ADMIN_PASSWORD | 관리자 비밀번호, 기본 `0000` |
| ADMIN_SESSION_SECRET | 선택: 관리자 세션 서명용 긴 임의의 비밀값. 미설정 시 DB 연결 문자열을 사용; 로컬 DB만 쓰면 서버 재시작 시 관리자 로그아웃 |
| POSTGRES_URL | DATABASE_URL이 없을 때 사용하는 대체 변수 |
| PUBLIC_URL | 선택: 고정 공유 주소. 없으면 Vercel 접속 도메인으로 QR 생성 |
| PORT | 로컬 포트, 기본 4977 |
| HOST | 로컬 접속 인터페이스, 기본 0.0.0.0 |
| DATA_FILE | 로컬 SQLite 위치, 기본 data/stories.sqlite |

로컬 QR는 같은 네트워크 참가용입니다. 기기 간 연결이 허용되어야 하며 방화벽 설정은 변경하지 않습니다. Vercel 배포 시 QR는 HTTPS 배포 주소를 가리킵니다.

## 검증

실행: `node --test tests/*.test.mjs`

21개 테스트로 SQLite/HTTP 경로와 PostgreSQL 저장, 중복 요청, 하트 취소, 한글 처리, 클라우드 저장소 미설정, 소유자/관리자 수정·삭제 권한을 확인했습니다. PostgreSQL 쿼리는 실제 PostgreSQL 엔진인 PGlite로 검증했으며 실제 Supabase 계정 연결은 배포 후 별도 확인해야 합니다. [검증 기록](./docs/verification.md).

## 구성 및 출처

- server.mjs: 로컬/Vercel 공통 Node 서버 진입점
- src/configured-store.mjs: 환경에 따른 저장소 선택
- src/postgres-store.mjs: Postgres.js 드라이버와 PostgreSQL 저장
- src/store.mjs: 로컬 SQLite 저장
- public/: 화면·글꼴·예시
- [Vercel Node 서버 문서](https://vercel.com/docs/functions/runtimes/node-js)
- [Supabase 연결 안내](https://supabase.com/docs/guides/database/postgres-js)
- [Pretendard](https://github.com/orioncactus/pretendard) — 라이선스는 public/fonts/LICENSE.txt에 포함
- [node-qrcode](https://github.com/soldair/node-qrcode) — 서버에서 QR 생성

