# 렌더링 전략

첫 응답에 콘텐츠가 들어 있는지가 체감 속도를 가장 크게 바꾼다. 이 문서는 렌더링 방식 선택, CSR 체인, 스트리밍 SSR, 데이터 재사용, 요청자별 응답을 다룬다.

## 1. 결정표

| 페이지 성격 | 기본 선택 | 비고 |
|---|---|---|
| 모두에게 같은 콘텐츠 (뉴스, 블로그, 문서, 상품 상세, 목록) | 정적 생성(SSG)/ISR, 또는 SSR + CDN 캐시 | `caching.md`의 TTL 표를 따른다. 개인화는 로드 뒤 API로 분리 |
| 사람마다 다른 피드 (타임라인, 추천) | 스트리밍 SSR | 셸을 먼저 보내고 영역별로 이어서 보낸다 |
| 로그인 뒤 상호작용이 많은 화면 (대시보드, 편집기, 관리자) | CSR + 스켈레톤 허용 | 검색 노출이 필요 없고 재방문이 많다. 대신 JS 크기와 API 왕복을 줄인다 |
| 공개 페이지인데 사람마다 일부만 다름 | 공개 부분은 캐시된 HTML, 개인 부분은 클라이언트 요청 또는 PPR | Next.js Cache Components의 PPR은 `stacks.md` |

## 2. CSR 체인이 느린 이유

CSR 페이지는 콘텐츠를 보여주기까지 이렇게 진행된다.

```text
HTML 셸 요청 → 셸 도착 → JS 요청 → JS 다운로드 → 파싱·실행 → API 요청 → 응답 → 렌더
```

화살표마다 네트워크 왕복이나 CPU 작업이 있고, 앞 단계가 끝나야 다음이 시작된다. 느린 망(RTT 150ms, 1.6Mbps)에서는 JS 몇 MB를 받는 데만 수십 초가 걸린다. X는 이 구조에서 첫 게시물까지 23.9초가 걸렸고, 서버 렌더링으로 바꾼 뒤 2.7초가 됐다 (`case-studies.md`).

진단 방법: DevTools Network 워터폴에서 첫 콘텐츠가 보이기 전 직렬 단계 수를 센다. HTML 응답 본문에 콘텐츠 텍스트가 있는지 `curl -s URL | grep '본문 일부'`로 확인한다.

## 3. 스트리밍 SSR과 TTFB

서버가 데이터를 받아 렌더링한 뒤 응답하면 TTFB는 늘 수 있다. 그래도 콘텐츠가 보이는 시간은 줄어든다. X는 TTFB가 300ms 미만에서 430~560ms로 늘었지만, 첫 콘텐츠 전에 받던 JS가 게시물과 프로필 페이지에서 3.0~3.6MB에서 0MB가 됐다.

그래서 TTFB 하나로 판단하지 않는다. 제품 지표(첫 게시물, 첫 상품이 보인 시간)와 LCP를 같이 본다. TTFB 예산(800ms)은 캐시된 HTML이나 정적 HTML에 적용하고, 스트리밍 SSR은 콘텐츠 지표로 판단한다.

스트리밍에서는 셸과 느린 영역을 나눈다. React는 `<Suspense fallback>` 경계마다 HTML 조각을 이어서 보낸다. 가장 중요한 콘텐츠가 가장 느린 데이터에 묶이지 않게 경계를 잡는다.

## 4. 데이터를 두 번 받지 않는다

- 라우트마다 필요한 데이터를 선언하고(라우트 로더), 렌더링과 동시에 요청을 시작한다. 컴포넌트가 마운트된 뒤 `useEffect`에서 요청하면 워터폴이 생긴다. React Router/Remix의 `loader`, TanStack Router의 `loader`, Next.js 서버 컴포넌트의 `await fetch`가 이 역할을 한다.
- 서버가 받은 API 응답을 HTML에 JSON 텍스트로 한 번만 넣고, 브라우저에서 클라이언트 캐시(React Query, SWR, Relay, Apollo)에 다시 채운다. 같은 API를 브라우저가 또 부르지 않는다.
- 정규화된 스토어 전체를 직렬화하지 않는다. X는 Relay 스토어 레코드가 원래 응답보다 4~5배 커서, 원본 GraphQL 응답 JSON을 넣고 클라이언트에서 다시 처리하도록 바꿨다.
- JSON은 `<script type="application/json" id="__DATA__">`에 넣고 `JSON.parse`로 읽는다. 큰 객체를 JS 리터럴로 넣는 것보다 파싱이 빠르다. `</script>` 같은 문자열은 `\u003c`로 이스케이프한다.

React Query 예시:

```jsx
// 서버: 렌더 중 받은 응답을 그대로 기록
const payload = { queries: [{ key: ['post', id], data: rawResponse }] };
html += `<script type="application/json" id="__DATA__">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;

// 클라이언트: 하이드레이션 전에 캐시를 채운다
const { queries } = JSON.parse(document.getElementById('__DATA__').textContent);
for (const q of queries) queryClient.setQueryData(q.key, q.data);
```

## 5. 요청자별 응답

| 요청자 | 줄 것 | 뺄 것 |
|---|---|---|
| 사람 | 스트리밍 HTML, 하이드레이션 JS | |
| 검증된 검색 크롤러 | 모든 영역이 채워진 완성 HTML, 메타 태그, 구조화 데이터 | JS 번들, 라우터 상태, 스켈레톤, 로그인 유도 UI |
| 링크 미리보기 봇 (Slack, 카카오톡, iMessage, Discord) | `<title>`, description, `og:*`, `twitter:*` | 본문 렌더링과 본문용 데이터 요청 |
| 확인되지 않은 봇 | 일반 비로그인 사용자와 같은 응답 | |

크롤러 판별은 User-Agent가 아니라 IP 검증으로 한다. User-Agent만 보면 누구나 헤더를 바꿔 비싼 크롤러용 렌더링을 일으킬 수 있고, Lighthouse 측정도 엉뚱한 응답을 받는다.

- Google 방식: 요청 IP를 역방향 DNS로 조회해 `googlebot.com`, `google.com`, `googleusercontent.com` 도메인인지 확인하고, 그 호스트 이름을 다시 정방향 조회해 같은 IP가 나오는지 본다. 공개 IP 목록(`common-crawlers.json` 등)과 대조해도 된다 ([문서](https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot)). 결과는 IP 단위로 캐시한다.
- CDN 기능: Cloudflare Workers의 `request.cf.botManagement.verifiedBot`, `request.cf.verifiedBotCategory`는 Bot Management를 쓸 때만 값이 채워진다 ([문서](https://developers.cloudflare.com/bots/reference/bot-management-variables/)). 요금제별 제공 범위는 확인 필요.
- 미리보기 봇은 비용이 낮은 응답이라 User-Agent로 골라도 위험이 작다. 잘못 판별돼도 메타 태그만 가는 정도다.

크롤러용 HTML 크기: Googlebot은 지원 파일 형식의 앞 2MB만 가져와 색인한다 ([문서](https://developers.google.com/search/docs/crawling-indexing/googlebot)). 2026년 3월 Google 블로그는 이 한도가 압축 전 크기이고 응답 헤더도 포함한다고 설명한다. 긴 페이지는 이렇게 줄인다.

- 반복되는 인라인 SVG 아이콘을 `<symbol>` 스프라이트로 빼고 `<use href="#icon">`로 참조한다.
- 구조화 데이터(JSON-LD)에서 같은 텍스트와 URL이 반복되지 않게 `@id` 참조로 묶는다.
- JS가 있어야만 쓰는 출력(하이드레이션용 속성, 클라이언트 상태)을 크롤러 응답에서 뺀다.
- `scripts/parity.mjs --ua googlebot`이 2MB 초과를 경고한다.

## 6. OG 이미지 분리

공유 미리보기 이미지를 페이지 렌더 서버에서 만들면 이미지 요청이 몰릴 때 HTML 응답까지 느려진다. OG 이미지는 별도 엣지 함수나 서비스로 만들고, 결과를 URL별로 길게 캐시한다. URL에 내용 버전(글 수정 시각 등)을 넣으면 무효화 없이 갱신된다.
