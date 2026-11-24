# 출처 간 충돌과 판정

이 스킬은 공개된 성능 스킬 세 개와 두 사례 글, 공식 문서를 함께 읽고 실제 사이트에 돌려 본 뒤 새로 썼다. 출처끼리 같은 입력에 다른 행동을 시키는 곳을 아래처럼 판정했다. 판정 근거는 시험 실행 결과와 공식 문서다.

출처 약칭:
- **wq**: addyosmani/web-quality-skills (`performance`, `core-web-vitals`)
- **cf**: cloudflare/skills (`web-perf`)
- **lh**: nimajafari/lighthouse-skill
- **GN**: GeekNews 캐시 글, **X**: X 웹 재구축 글
- **draft**: 이 저장소를 만들기 전의 개인 초안

| # | 충돌 | 판정 |
|---|---|---|
| 1 | **JS 예산.** wq는 압축 JS 300KB를 시작 예산으로 둔다. 이 스킬의 요구사항은 첫 화면 170KB다. | 기본값 170KB. 프로젝트에 예산이 있으면 그것을 따른다. 느린 프로파일 기준 스킬이므로 낮은 쪽을 기본으로 한다. |
| 2 | **성능 진단 도구.** wq는 성능 진단을 Lighthouse가 아니라 DevTools 트레이스로 하라고 한다. lh는 Lighthouse로 재고 고치라고 한다. | 원인 찾기는 트레이스(가능하면 DevTools MCP), 전후 비교는 Lighthouse 반복 실행(`lh-compare.mjs`). 하나의 실행 결과로 원인과 개선을 둘 다 말하지 않는다. |
| 3 | **반복 실행의 대표값.** lh는 성능 점수가 중앙값인 실행 하나를 고른다. X와 요구사항은 지표별 중앙값과 신뢰구간을 쓴다. | 지표별 중앙값. 점수 중앙값 실행은 LCP와 TBT가 서로 다른 실행에서 나온 값과 섞이지 않는 장점이 있지만, 지표별 비교에는 부정확하다. |
| 4 | **Node 버전.** 요구사항은 Node 20 이상이다. Lighthouse 13은 Node 22.19 이상을 요구한다. | 스크립트는 Node 20에서 돌고, Node 22.19 미만이면 `lighthouse@12`를 자동으로 쓴다. 결과에 Lighthouse 버전을 찍어 비교 대상끼리 버전이 같은지 보게 한다. |
| 5 | **스크립트 로딩.** wq는 `defer`를 기본으로 권한다. X는 스트리밍 HTML에서 `async` 모듈로 바꿔 하이드레이션을 앞당겼다. | 스트리밍 SSR이면 진입 스크립트는 `type="module" async`. 일반 페이지는 `defer`나 기본 모듈. |
| 6 | **TTFB 판단.** cf와 wq는 TTFB 800ms 미만을 좋음으로 본다. X는 TTFB가 늘었는데 콘텐츠는 크게 빨라졌다. | TTFB 예산은 캐시된 HTML과 정적 HTML에만 적용한다. 스트리밍 SSR은 제품 지표와 LCP로 판단한다. |
| 7 | **선제 로딩.** wq 예시는 `/*` 전체에 `moderate` prerender를 건다. X는 hover/focus 의도, 리스트는 100ms 체류로 좁혔다. | 기본은 가능성 높은 경로만 prefetch(`moderate`). prerender는 다음 이동이 거의 확실한 곳에만. 서버 비용과 분석 이벤트 중복을 같이 잰다. |
| 8 | **단정 vs 가설.** cf는 확인 후 단정적으로 말하라고 한다. wq는 실행 없이 코드만 본 결과를 가설로 부르라고 한다. | 측정이나 응답 헤더로 확인한 것은 단정해서 쓴다. 코드만 보고 추정한 것은 "가설"로 표시하고 확인 명령을 붙인다. 두 규칙은 근거 유무로 나뉜다. |
| 9 | **접근성 검사 포함 여부.** cf는 성능 감사 안에 접근성 스냅샷 단계를 둔다. | 이 스킬 범위 밖. 성능 보고서에 넣지 않는다. 필요하면 별도 접근성 스킬을 쓴다. |
| 10 | **CSS 지연.** wq는 비핵심 CSS를 `preload` + `onload`로 늦추라고 한다. X는 CSS를 먼저 받고 JS를 나중에 붙였다. | 첫 화면 CSS는 막는 채로 먼저 받고, JS 진입점을 CSS 로드 뒤로 미룬다. 첫 화면에 안 쓰는 CSS만 지연 로드한다. |
| 11 | **103 Early Hints.** wq는 측정된 문서 지연이 있으면 고려하라고 한다. 요구사항은 선택 사항으로 둔다. | 선택. 트레이스에서 HTML 생성이 느리고 필요한 하위 리소스가 고정일 때만. Safari는 preload 힌트를 쓰지 않는다. |
| 12 | **font-display.** draft는 `swap`을 기본으로 둔다. 레이아웃 흔들림을 줄이려면 `optional`이 낫다는 관점도 있다. | 본문은 `swap` + 대체 폰트 크기 맞춤. CLS가 문제인 페이지는 `optional`. |
| 13 | **이미지 lazy loading.** draft는 이미지에 lazy loading을 쓰라고 일반화한다. wq와 요구사항은 LCP 이미지 lazy 금지다. | 화면 밖 이미지만 lazy. LCP 후보 이미지는 lazy 금지, `fetchpriority="high"`. |
| 14 | **서비스 워커.** wq는 서비스 워커 캐시를 권한다. 요구사항의 측정 프로파일은 서비스 워커를 끈다. | 기준선은 서비스 워커 없이 잰다(첫 방문 사용자). 서비스 워커는 재방문 최적화로 따로 잰다. |
| 15 | **공개 HTML의 Set-Cookie 경고.** 요구사항은 "HTML + set-cookie + public이면 경고"다. 시험에서 실제 사이트가 HIT 응답마다 다른 쿠키 값을 붙였다(엣지에서 추가). | `check-cache.sh`는 HIT 응답끼리 쿠키 값을 비교한다. 같은 값이 반복되면 치명적 경고, 매번 다르면 엣지 추가로 보고 내용 확인만 요청한다. 요청 사이 1초 간격을 기본으로 둔다(초 단위 타임스탬프 쿠키를 구분하려고). |
| 16 | **s-maxage와 stale-while-revalidate.** 일반 레시피는 둘을 함께 쓴다. Cloudflare 문서는 함께 쓰지 말라고 한다. | 일반 레시피는 유지하고, Cloudflare 뒤에서는 엣지 수명을 `Cloudflare-CDN-Cache-Control`/`CDN-Cache-Control`로 따로 준다. |
| 17 | **크롤러 판별.** 흔한 구현은 User-Agent로 판별한다. X와 Google 문서는 IP 검증을 쓴다. | 비싼 응답(완성 HTML)은 IP 검증 뒤에만. 메타 태그만 주는 미리보기 봇은 User-Agent로 골라도 된다. |
| 18 | **PSI 전략 기본값.** PSI API 기본은 데스크톱이다. 요구사항은 모바일 기준이다. | 항상 `strategy=mobile`을 명시한다. 키 없는 호출은 공유 할당량 429가 나므로 키를 쓴다(시험에서 확인). |
| 19 | **Vite 청크 설정.** 요구사항은 `manualChunks` 예시를 원한다. Vite 8은 객체형 `manualChunks`를 없애고 `codeSplitting`을 쓴다. | 버전별로 둘 다 싣는다. Vite 8은 `rolldownOptions.output.codeSplitting`, 7 이하는 함수형 `manualChunks`. |
| 20 | **bfcache와 no-store.** 요구사항은 HTML `no-store`의 bfcache 영향을 확인하라고 한다. Chrome은 조건부로 no-store 페이지도 bfcache에 넣기 시작했다. | 영향은 브라우저마다 다르다고 쓴다. 개인 데이터가 없는 HTML은 `no-cache`나 `max-age=0`을 권한다. |
| 21 | **봇 차단 응답.** 출처 스킬 모두 응답 헤더를 그대로 믿는다. 시험에서 curl 기본 User-Agent는 CDN 함수가 만든 403 차단 페이지를 받았다. | `check-cache.sh`는 브라우저 User-Agent를 기본으로 쓰고, 403/429가 엣지 생성 응답이면 "차단 페이지를 보고 있다"고 경고한다. |

## 출처가 다루지 않은 것

출처 스킬 셋은 모두 브라우저 쪽 지표 중심이다. CDN HIT/MISS 확인, 개인화 분리, 콘텐츠 나이별 TTL, 무효화 범위, 요청자별 응답, 이벤트 루프 지연, parity 검사는 사례 글과 공식 문서에서 가져와 새로 썼다. 시험에서 가장 큰 빈틈이 서버와 CDN 계층이었기 때문이다.
