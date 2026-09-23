# GitHub → Vercel + Supabase 배포

## 1. Supabase DB 만들기

Supabase에서 프로젝트를 만들고 DB 비밀번호를 보관합니다. 프로젝트의 **Connect → Transaction pooler → URI**에서 연결 문자열을 복사하세요. Vercel 같은 서버리스 환경에는 Transaction pooler(일반적으로 포트 6543)를 사용합니다. [Supabase 공식 안내](https://supabase.com/docs/guides/database/postgres-js).

연결 문자열 형식은 다음과 같습니다. 실제 호스트와 프로젝트 식별자는 Supabase 화면에서 복사하세요.

```text
postgresql://postgres.PROJECT_REF:PASSWORD@YOUR_POOLER_HOST:6543/postgres
```

PASSWORD 자리에는 **DB 비밀번호**를 넣습니다. URL에서 특별한 의미가 있는 문자(@, #, / 등)는 URL 인코딩해야 합니다. 익명 API 키나 service_role 키를 비밀번호 자리에 넣지 마세요. 이 앱은 서버에서 PostgreSQL로 연결하므로 SUPABASE_URL, anon key, service_role key를 프런트엔드에 설정할 필요가 없습니다.

## 2. GitHub 업로드

ZIP을 압축 해제한 뒤 소스 파일을 GitHub 저장소에 올립니다. ZIP 파일 자체만 올리지 마세요. 저장소에는 package.json, server.mjs, vercel.json, public/, src/가 포함되어야 합니다.

node_modules/, data/, .env.local, 실제 DB 연결 비밀번호는 제외합니다. .gitignore가 포함되어 있으며 .env.example은 실제 비밀값이 없는 예시입니다.

## 3. Vercel 설정

Vercel에서 GitHub 저장소를 Import합니다.

- **Root Directory:** package.json과 server.mjs가 있는 폴더
- **Node.js:** 24.x
- 빌드/출력 경로: 자동 설정 유지. public 폴더만 정적 사이트로 배포하지 마세요.
- **Environment Variables → DATABASE_URL:** 1단계에서 얻은 Supabase Transaction pooler URI
- **ADMIN_PASSWORD:** 기본값은 요청한 `0000`. 별도 설정 없이 이 비밀번호로 로그인할 수 있습니다.
- **ADMIN_SESSION_SECRET:** 선택. 관리자 세션 서명용 긴 임의 비밀값. 미설정 시 DATABASE_URL을 사용합니다. 로그인은 8시간 유지됩니다.
- **PUBLIC_URL:** 선택 항목. QR 주소를 특정 도메인으로 고정할 때만 설정

DATABASE_URL은 Production에 설정합니다. Preview 테스트에는 별도 Supabase 프로젝트를 쓰면 실제 참가자의 사연과 테스트 사연이 섞이지 않습니다. 환경 변수를 추가/변경했다면 Redeploy해야 적용됩니다.

Vercel은 api/index.mjs 서버 함수와 vercel.json의 rewrites 설정을 사용합니다. 별도 프런트엔드 빌드 명령은 필요하지 않습니다. [Vercel 공식 Node 문서](https://vercel.com/docs/functions/runtimes/node-js).

## 4. 데이터 저장과 테이블

최초 DB 요청 때 다음 테이블이 자동 생성됩니다.

- **workshop_stories:** 제출 사연
- **workshop_hearts:** 참가자별 하트

자동 초기화에는 테이블 생성 권한이 필요하므로 Supabase Connect에서 제공하는 postgres 사용자 연결 문자열을 사용하세요. 테이블 소유자인 서버 DB 사용자는 읽기/쓰기를 수행합니다.

두 테이블은 **RLS가 활성화되고 브라우저용 허용 정책은 생성하지 않습니다.** 브라우저는 Supabase 테이블에 직접 접근하지 않고 이 앱의 서버 API를 사용합니다. Supabase에서 “RLS enabled, no policies”가 표시되어도 이 구조에서는 정상입니다. Supabase Table Editor에서 저장된 사연을 확인할 수 있습니다.

DB 설정이 없는 Vercel 환경에서는 503으로 저장을 거부합니다. Vercel 함수의 임시 파일에 저장하지 않으므로, DATABASE_URL 연결을 마쳐야 실제 사용이 가능합니다. 로컬 SQLite의 사연은 자동으로 Supabase에 이전하지 않습니다.

## 5. 배포 후 확인

1. 배포 주소의 사연 올리기에서 확인용 사연을 제출합니다.
2. 다른 브라우저나 휴대폰으로 사연 모아보기를 열어 같은 사연을 확인합니다.
3. 하트를 눌러 다른 화면에도 반영되는지 확인합니다.
4. 새로고침/재배포 후 사연과 하트가 남아 있는지 확인합니다.
5. QR 코드가 배포한 HTTPS 주소로 연결되는지 확인합니다.

확인용 사연도 실제 DB에 저장됩니다. 작성한 브라우저의 삭제 버튼이나 관리자 로그인 후 삭제 버튼으로 해당 확인용 사연을 제거할 수 있습니다.

## 사연 관리

참가자는 사연을 작성한 브라우저에서 카드의 **수정·삭제** 버튼을 사용할 수 있습니다. 새로고침 후에도 쿠키가 남아 있으면 본인 사연으로 인식합니다. 수정하면 기존 하트와 작성 시각이 유지되고, 삭제하면 해당 사연의 하트도 삭제됩니다.

화면 하단 **관리자** → 비밀번호 **0000** → 로그인하면 모든 실제 사연에 수정·삭제 버튼이 표시됩니다. 작업 후 **관리자 로그아웃**을 누르세요. 예시 사연은 서버 저장 대상이 아닙니다. 관리자 비밀번호와 권한은 서버에서 검사합니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 저장/목록 연결 오류 | DATABASE_URL, 적용 환경, 재배포 여부 |
| 인증 실패 | DB 비밀번호, URL 인코딩, postgres.PROJECT_REF 사용자명 |
| 연결 시간 초과 | Transaction pooler 주소와 포트, Supabase 프로젝트 실행 상태 |
| 테이블 생성 권한 오류 | Supabase 기본 postgres 사용자 연결인지 확인 |
| SSL 인증서 오류 | 복사한 공식 pooler 호스트와 네트워크 인증서를 확인. 인증서 검증을 끄지 마세요 |
| 홈은 열리나 API가 404 | Root Directory 및 정적 출력 경로를 강제 설정했는지 확인 |

실제 Supabase 연결과 Vercel 공개 배포는 계정 설정 후 위 절차로 확인해야 합니다.

배포 폴더 주의: GitHub에 `workshop-stories-github` 폴더째 올렸다면 Vercel Root Directory를 `workshop-stories-github`로 지정합니다. 파일을 저장소 최상위에 올린 경우에는 비워 둡니다.

Supabase TLS 인증서 검증에는 공식 다운로드 인증서 `src/certs/supabase-ca.crt`를 사용합니다. 출처: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
