---
name: site-speed-optimization
description: 웹사이트·웹앱이 느릴 때 원인을 진단하고 개선할 때 사용. 캐시(CDN·마이크로캐시·정적 HTML), 렌더링(SSR·스트리밍), 프론트엔드(LCP·INP·CLS·번들), 백엔드(DB·병렬화), 측정과 검증까지 다룸.
---

# 사이트 속도 개선

느린 웹사이트를 **진단 → 원인 분류 → 스택에 맞는 설정 적용 → 측정으로 검증**까지 진행한다. 기준 사례는 GeekNews의 캐시 재설계와 X.com의 웹 재구축이다(`references/case-studies.md`).

이 스킬의 파일 경로는 스킬 폴더 기준이다. 스크립트는 `<스킬 폴더>/scripts/`에 있다.

## 핵심 원칙

1. **첫 응답에 콘텐츠를 담는다.** HTML 셸 → JS → 실행 → API → 렌더 체인은 느린 망에서 왕복마다 수 초씩 쌓인다. X는 첫 게시물이 23.9초에서 2.7초가 됐다.
2. **계산을 빨리 하기 전에 계산을 안 하는 방법을 찾는다.** 서버를 키우기 전에 "이 요청이 매번 앱과 DB까지 가야 하는가"를 묻는다.
3. **사람마다 다른 데이터는 생각보다 적다.** 개인화가 조금 섞였다고 페이지 전체 캐시를 포기하지 않는다. 개인 부분만 떼어 낸다.
4. **사람, 크롤러, 미리보기 봇에게는 각자 필요한 것만 준다.**
5. **지표는 사용자가 실제로 기다리는 순간으로 잡는다.** 스플래시도 FCP로 잡힌다. 첫 게시물, 첫 상품, 본문이 보인 시간을 주 지표로 둔다.

공식 문서로 확인하지 않은 프레임워크 API와 설정 문법은 쓰지 않는다. references에 "확인 필요"로 표시된 항목은 적용 전에 해당 버전 문서를 연다.

## 실행 절차

각 단계가 끝나면 아래 "보고" 항목을 사용자에게 짧게 남긴다.

### 1. 스택 파악

- 실행: `package.json`과 lockfile(프레임워크와 버전), 설정 파일(`next.config.*`, `vite.config.*`, `astro.config.*`, `wrangler.*`, `vercel.json`, `nginx.conf`, CloudFront/Terraform 설정), DB 클라이언트와 ORM을 확인한다. 배포된 URL이 있으면 응답 헤더를 본다.
  ```bash
  curl -sI -A "Mozilla/5.0" https://example.com/ | grep -iE 'server|x-cache|cf-cache-status|x-vercel-cache|x-nextjs-cache|cache-control|age|via'
  ```
- 보고: 프레임워크와 버전, 렌더링 방식(CSR/SSR/SSG/스트리밍), 호스팅과 CDN, DB와 연결 방식. 코드 없이 URL만 있으면 그렇다고 적고 4단계 이후는 "가설"로 표시한다.

### 2. 주 지표 정의

- 실행: 사용자가 기다리는 순간을 하나 고른다. 예: 첫 게시물, 첫 상품 이미지와 가격, 본문 첫 문단. 대표 URL을 페이지 종류별로 2~5개 고른다(첫 화면, 상세, 목록).
- 보고: 주 지표 이름, 측정 방법(`references/measurement.md` 5절), 대표 URL 목록.

### 3. 기준선 측정

- 실행:
  ```bash
  node scripts/lh-compare.mjs <대표 URL> --runs 7 --slow          # 실험실: 모바일, 느린 프로파일
  ./scripts/check-cache.sh <대표 URL> 3                           # 캐시 헤더, HIT/MISS, TTFB
  ./scripts/check-cache.sh <대표 URL> 3 --cookie "<세션 쿠키>"   # 로그인 사용자가 받는 응답
  ```
  가능하면 실사용 데이터도 본다: PSI API(`strategy=mobile`, 키 필요)나 CrUX API로 p75 LCP/INP/CLS(`references/measurement.md` 8절). 서비스에 RUM이 있으면 그 값을 먼저 쓴다.
- 보고: 지표별 중앙값과 최소/최대, 실사용 p75(있으면, URL 단위인지 출처 단위인지), 캐시 상태와 경고. 실행 조건(프리셋, 프로파일, 횟수, Lighthouse 버전)을 같이 적는다.

### 4. 원인 분류

- 실행: 아래 표로 증상을 원인에 연결한다. 확인은 DevTools 성능 트레이스와 Network 워터폴로 한다(Chrome DevTools MCP가 있으면 `performance_start_trace`와 insight 분석). 코드만 보고 추정한 원인은 "가설"로 표시하고 확인 명령을 붙인다.
- 보고: 원인 목록을 영향이 큰 순서로. 각 원인에 근거(측정값, 헤더, 트레이스 항목)를 붙인다.

### 5. 해법 적용

- 실행: 원인별로 해당 references 파일과 `references/stacks.md`의 스택 절을 따른다. 한 번에 하나씩 바꾸고, 바꿀 때마다 6단계 측정을 다시 할 수 있게 커밋을 나눈다.
- 보고: 바꾼 파일과 설정, 바꾼 이유(원인 번호).

### 6. 재측정과 전후 비교

- 실행: 기존과 새 버전을 번갈아 실행해 비교한다. 캐시를 바꿨다면 아래 "캐시 적용 후 검증"도 한다.
  ```bash
  node scripts/lh-compare.mjs <기존 URL> <새 URL> --runs 9 --slow
  ```
  같은 URL의 배포 전후를 비교할 때는 배포 전 결과(`lh-results/*/summary.json`)를 보관해 두었다가 같은 조건으로 다시 잰다.
- 보고: 지표별 전후 중앙값, 차이, 95% 신뢰구간, 판정. **나빠진 지표도 함께 적는다.** 신뢰구간이 0을 포함하면 "차이 없음"으로 쓴다. 실사용 값은 배포 후 몇 주 뒤에 확인할 항목으로 남긴다.

## 증상 → 원인 → 참고 문서

| 증상 | 확인 방법 | 원인 | 참고 |
|---|---|---|---|
| TTFB가 높음 | `check-cache.sh`에서 MISS/BYPASS/DYNAMIC, 캐시 헤더 없음 | 캐시 MISS: 공개 HTML이 캐시되지 않음 (세션 읽기, `Set-Cookie`, `Vary: Cookie`, `no-store`, CDN이 HTML을 기본으로 캐시하지 않음) | `caching.md`, `stacks.md` |
| TTFB가 높음 | MISS일 때 원점 처리 시간이 김 (앱 로그 p95) | DB/백엔드가 느림: N+1, 인덱스 없음, 직렬 요청, 먼 DB 리전, 연결 부족 | `backend.md` |
| TTFB는 낮은데 콘텐츠가 늦게 뜸 | HTML 본문에 콘텐츠 텍스트가 없음, 워터폴에 셸 → JS → API 직렬 체인 | CSR 체인 | `rendering.md` |
| LCP 이미지가 늦게 뜸 | 트레이스의 LCP 분해에서 리소스 로드 지연이 큼, 이미지가 lazy이거나 늦게 발견됨 | preload/`fetchpriority` 없음, 큰 이미지 포맷, 크기 안 맞음 | `frontend.md` 1절 |
| 초기 JS 요청이 많거나 큼 | `lh-compare` JS 요청 수와 전송량, 번들 분석 | 청크가 잘게 쪼개짐, 로그인 코드가 비로그인에 섞임, 서드파티, 빌드 플러그인 잔여물 | `frontend.md` 4·8·10절 |
| INP가 나쁨 | 실사용 INP p75, 실험실 TBT, 트레이스의 긴 작업 | 긴 작업, 하이드레이션 비용, 무거운 이벤트 핸들러 | `frontend.md` 3절 |
| CLS가 나쁨 | 트레이스의 레이아웃 이동 요소, `web-vitals` attribution | 이미지/iframe 크기 미지정, 웹폰트 교체, 동적 삽입 | `frontend.md` 2절 |
| 트래픽이 몰리면 느려짐 | 부하 시 p95 상승, 원점 요청 수 급증, 가짜 타임아웃 | 마이크로캐시 없음(캐시 쇄도), Node 이벤트 루프 지연 | `caching.md` 1절, `examples/nginx-microcache.conf`, `backend.md` 4절 |
| 첫 방문은 괜찮은데 뒤로 가기가 느림 | DevTools bfcache 테스트 | `unload` 핸들러, `no-store` HTML | `frontend.md` 12절 |
| 검색 노출이나 링크 미리보기가 이상함 | `parity.mjs --ua googlebot`, 2MB 경고 | 크롤러 HTML이 크거나 메타 태그 누락 | `rendering.md` 5절 |

## 기준값

**Core Web Vitals "좋음"** (p75, 모바일과 데스크톱 따로): LCP 2.5초 이하, INP 200ms 이하, CLS 0.1 이하.

**권장 예산 (조정 가능한 기본값).** 프로젝트에 예산이 있으면 그것을 따른다.

| 항목 | 기본값 |
|---|---|
| 첫 화면 JS (압축 후) | 170KB 이하 |
| 초기 요청 수 | 50개 이하 |
| HTML 첫 응답 (TTFB) | 800ms 이하 (캐시된 HTML 기준. 스트리밍 SSR은 콘텐츠 지표로 판단) |

`examples/lighthouserc.json`이 이 값을 CI 조건으로 쓴다.

## 실행 체크리스트

작은 서비스 기준 우선순위 순서다. 위에서부터 하고, 해당 없는 항목은 건너뛴다.

- [ ] 주 지표 정의, 느린 프로파일 기준선 측정 (`lh-compare.mjs --slow`)
- [ ] 요청량 많고 비싼 공개 GET 찾기 (CDN/접근 로그 × 앱 처리 시간)
- [ ] 그 요청에 세션이 정말 필요한지 확인, 개인화는 로드 뒤 `no-store` API로 분리
- [ ] 공개 HTML에서 `Set-Cookie`, `Vary: Cookie`, 불필요한 `no-store` 제거 (`check-cache.sh`)
- [ ] 15초 마이크로캐시 (원점 Nginx 또는 CDN `s-maxage=15`)
- [ ] 캐시 키 정규화 (쿼리 순서, `utm_*`, `page=1`, 쿠키 제외)
- [ ] 콘텐츠 나이별 TTL, 오래된 페이지는 긴 TTL과 정적 HTML
- [ ] 바뀐 URL만 무효화, 전체 퍼지 금지
- [ ] 첫 응답에 콘텐츠 담기 (SSR, 스트리밍, 정적 생성)
- [ ] 서버 데이터를 HTML에 한 번만 넣고 클라이언트 캐시에 재사용
- [ ] 서로 의존하지 않는 서버 요청 병렬화, N+1 제거
- [ ] LCP 이미지 `fetchpriority="high"`, lazy 제거, AVIF/WebP, 크기 지정
- [ ] 초기 JS 파일 수 줄이기 (배포 주기 기준 청크, 로그인/비로그인 진입점 분리)
- [ ] CSS 먼저, JS는 그다음. 스트리밍이면 `async` 모듈
- [ ] 폰트와 서드파티 정리 (시스템 폰트, 서브셋, 파사드, 지연 로드)
- [ ] 크롤러와 미리보기 봇 응답 분리 (IP 검증, 2MB 이하)
- [ ] 이벤트 루프 지연 모니터링 (Node SSR)
- [ ] 적중률을 페이지 종류와 콘텐츠 나이로 분해해 다음 순서 정하기
- [ ] Lighthouse CI와 실사용 수집(`web-vitals`) 연결

## 캐시 적용 후 검증

캐시를 바꾼 뒤에는 다음을 모두 확인하고 결과를 보고한다.

- [ ] 익명 사용자와 로그인 사용자가 같은 공개 HTML을 받는다: `check-cache.sh <URL>`과 `check-cache.sh <URL> --cookie "<세션>"`의 HIT 여부와 본문이 같은지 (`curl -s` 결과를 `diff`).
- [ ] 캐시된 응답에 `Set-Cookie`가 섞이지 않는다: `check-cache.sh`의 CRITICAL 경고가 없다.
- [ ] 개인정보가 공개 캐시에 남지 않는다: 로그인 상태로 요청한 직후 쿠키 없이 같은 URL을 요청해 사용자 이름, 이메일, 잔액 같은 값이 보이지 않는지 본문을 검색한다. `private`/`no-store` 응답이 HIT로 나오면 CDN이 원점 헤더를 무시하는 것이다.
- [ ] 글 작성, 수정, 삭제 직후 화면이 맞다: 작성자는 바로 새 내용을 보고, 다른 사용자는 TTL 안에 바뀐다. 삭제한 글은 즉시 사라진다.
- [ ] 무효화 후 해당 URL이 실제로 갱신된다 (`age` 헤더가 0부터 다시 시작).

## 피해야 할 것

- 로그인 쿠키가 있다고 캐시 전체를 우회하기
- 공개 HTML에 `Set-Cookie`를 붙이거나 `Vary: Cookie`를 보내기
- 모든 페이지에 같은 TTL, 재요청 간격보다 짧은 TTL
- 전체 캐시 퍼지를 일상적으로 쓰기, 좋아요나 투표마다 CDN 퍼지
- 조회수를 요청마다 DB에 쓰기
- User-Agent만 보고 크롤러에게 비싼 응답 주기
- TTFB나 FCP 하나만 보고 개선을 판단하기, 실행 한 번 결과로 결론 내기
- 나빠진 지표를 빼고 보고하기
- 번들 용량만 보고 파일 개수를 무시하기
- LCP 이미지에 `loading="lazy"`
- 빌드 도구 교체만으로 사용자 체감이 빨라질 거라 기대하기. 빌드 속도는 개발자 경험이고 첫 응답은 그대로다
- 공식 문서를 확인하지 않은 프레임워크 캐시 API 쓰기 (Next.js는 15와 16 사이에 기본값과 서명이 바뀌었다)

## references 안내

- `references/caching.md`: 4계층 구조, 페이지 유형별 Cache-Control, 개인화 분리 코드, 나이별 TTL, 무효화, 캐시 키, CDN별 차이, 적중률 분석
- `references/rendering.md`: 렌더링 방식 결정표, CSR 체인, 스트리밍 SSR과 TTFB, 데이터 재사용, 크롤러와 미리보기 봇 응답
- `references/frontend.md`: LCP, CLS, INP, JS 청크(Vite, Next.js), `async` 모듈, CSS 우선, 폰트, 서드파티, i18n, 화면 전환, bfcache
- `references/backend.md`: 병렬화, N+1과 `EXPLAIN ANALYZE`, keyset 페이지네이션, 서버리스 DB 연결, 이벤트 루프 지연, 앱 캐시
- `references/stacks.md`: Next.js(14/15/16), Cloudflare Workers/Pages, Vercel, Nginx + CloudFront, Astro, Remix/React Router
- `references/measurement.md`: 기준값과 예산, 실험실과 실사용, 느린 프로파일, 전후 비교 통계, 제품 지표, LHCI, PSI/CrUX API, 성능 PR 규칙
- `references/migration.md`: 기존 시스템을 명세로 쓰기, parity 검사, 점진 전환, AI 에이전트 운영 규칙
- `references/case-studies.md`: GeekNews와 X.com 수치와 출처
- `references/conflicts.md`: 출처 간 충돌 21건과 판정

## 스크립트와 예제

| 파일 | 용도 |
|---|---|
| `scripts/check-cache.sh <url> [횟수] [--cookie ...] [--json]` | 캐시 헤더, HIT/MISS, TTFB, 쿠키 누출, 압축 경고. bash와 curl만 필요 |
| `scripts/lh-compare.mjs <urlA> [urlB] --runs 7 --slow` | Lighthouse 반복 측정, A/B 교차 실행, 중앙값, 부트스트랩 95% 신뢰구간. 결과는 `./lh-results/` |
| `scripts/parity.mjs --a <old> --b <new> --paths paths.txt` | 두 서버의 상태 코드, 리다이렉트, 메타 태그, JSON-LD, HTML 크기 비교. 차이가 있으면 종료 코드 1 |
| `examples/nginx-microcache.conf` | 정적 HTML + 15초 마이크로캐시 + 세션 경로 우회 |
| `examples/lighthouserc.json` | LHCI 조건(LCP, CLS, TBT, 스크립트 크기, 요청 수) |
| `examples/web-vitals.js` | 실사용 LCP/INP/CLS/FCP/TTFB와 제품 지표를 `sendBeacon`으로 전송 |

모든 스크립트는 `--help`를 지원한다. 요구 사항: Node 20 이상, Lighthouse 측정에는 Chrome/Chromium.
