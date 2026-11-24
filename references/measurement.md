# 측정과 검증

측정 없이 고친 것은 개선이라고 부르지 않는다. 이 문서는 기준값, 실험실과 실사용 측정, 전후 비교 통계, 제품 지표, CI 연결을 다룬다.

## 1. 기준값

**Core Web Vitals "좋음"** (페이지 로드의 75번째 백분위수, 모바일과 데스크톱 따로) ([web.dev](https://web.dev/articles/vitals)):

| 지표 | 좋음 | 개선 필요 | 나쁨 |
|---|---|---|---|
| LCP | 2.5초 이하 | 4초 이하 | 4초 초과 |
| INP | 200ms 이하 | 500ms 이하 | 500ms 초과 |
| CLS | 0.1 이하 | 0.25 이하 | 0.25 초과 |

보조 지표: FCP 1.8초, TTFB 800ms (좋음 기준).

**권장 예산 (조정 가능한 기본값).** 서비스의 대상 기기와 망에 맞게 바꾼다. 프로젝트에 이미 예산이 있으면 그것을 따른다.

| 항목 | 기본값 | 비고 |
|---|---|---|
| 첫 화면 JS (압축 후) | 170KB 이하 | 느린 기기에서 다운로드, 파싱, 실행 비용을 묶어 두기 위한 출발점 |
| 초기 요청 수 | 50개 이하 | RFC 9113이 권장하는 동시 스트림 하한(100)의 절반. 서드파티 포함 |
| HTML 첫 응답 (TTFB) | 800ms 이하 | 캐시된 HTML과 정적 HTML 기준. 스트리밍 SSR은 콘텐츠 지표로 판단 (`rendering.md` 3절) |

## 2. 실험실과 실사용을 같이 본다

| 종류 | 도구 | 장점 | 한계 |
|---|---|---|---|
| 실험실 | Lighthouse, WebPageTest, DevTools 성능 트레이스 | 조건이 고정돼 전후 비교가 쉽고 원인을 볼 수 있다 | 실제 사용자 기기와 망 분포를 모른다. INP는 직접 못 잰다(TBT로 대신) |
| 실사용 | CrUX(Chrome 사용자 데이터), `web-vitals` RUM | 실제 사용자가 겪는 값이다 | 반영까지 시간이 걸린다(CrUX는 28일 이동 창). 원인은 따로 찾아야 한다 |

순서: 실사용 데이터로 나쁜 페이지와 지표를 고르고, 실험실 트레이스로 원인을 찾고, 고친 뒤 실험실에서 전후를 비교하고, 몇 주 뒤 실사용에서 확인한다. 배포 직후 실사용 값이 좋아졌다고 말하지 않는다.

## 3. 느린 프로파일

| 항목 | 값 |
|---|---|
| RTT | 150ms |
| 다운로드 | 1.6Mbps (1638.4Kbps) |
| 업로드 | 750Kbps |
| CPU | 4배 감속 |
| 캐시 | 비움 |
| 서비스 워커 | 끔 |

Lighthouse 모바일 기본값과 같다 ([throttling 문서](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)). `scripts/lh-compare.mjs --slow`는 Lighthouse 버전이 바뀌어도 이 값을 쓰도록 명시해서 넘긴다. Lighthouse는 실행마다 저장소(캐시, 서비스 워커 포함)를 비운다.

- `--method simulate`(기본): 빠르고 편차가 작다. 측정값은 시뮬레이션 추정치다.
- `--method devtools`: 브라우저에 실제로 지연을 건다. 느리지만 녹화한 화면과 비슷하다. 스트리밍이나 CSS 우선 로딩처럼 순서가 중요한 변경은 devtools로도 확인한다.

DevTools에서 직접 볼 때: Network 탭 "Disable cache" 체크, 스로틀링 "Slow 4G", Performance 탭 CPU 4x, Application > Service workers "Bypass for network".

## 4. 전후 비교 방법

1. 기존 버전(A)과 새 버전(B)을 같은 기기, 같은 망에서 번갈아 실행한다. 한쪽을 몰아서 돌리면 그사이 망이나 기기 상태 변화가 한쪽에만 섞인다.
2. 각 7~11회 실행하고 지표별 중앙값을 쓴다. 평균은 튀는 값 하나에 끌려간다.
3. 가능하면 부트스트랩 95% 신뢰구간을 구해 0을 벗어날 때만 개선이나 악화로 인정한다. 구간이 0을 포함하면 "차이 없음"이다.
4. 나빠진 지표도 같이 적는다.

`lh-compare.mjs`가 이 순서를 그대로 한다. 판정은 실행 5회 이상, 구간이 0을 벗어남, 차이가 A의 1% 이상이면서 최소 크기(10ms, 1KB, CLS 0.01, 요청 1개) 이상일 때만 낸다.

```bash
node scripts/lh-compare.mjs https://example.com/post/1 https://staging.example.com/post/1 --runs 9 --slow
```

부트스트랩을 직접 계산할 때: A와 B 각각에서 같은 개수를 복원 추출해 중앙값 차이를 구하는 일을 수천 번 반복하고, 그 분포의 2.5%와 97.5% 지점을 구간으로 쓴다.

## 5. 제품 지표

LCP는 "가장 큰 요소"일 뿐 사용자가 기다리는 것과 다를 수 있다. 스플래시 화면도 FCP로 잡힌다. 서비스마다 "기다리는 순간"을 정해 따로 잰다: 첫 게시물, 첫 상품 이미지와 가격, 본문 첫 문단.

```js
// 첫 게시물을 그리는 컴포넌트에서 한 번만
performance.mark('first-post');
```

```js
// 측정 코드: mark와 특정 요소의 렌더 시각을 수집
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name === 'first-post') send({ name: 'first-post', value: Math.round(entry.startTime) });
  }
}).observe({ type: 'mark', buffered: true });

// 이미지나 텍스트 블록이 실제로 그려진 시각 (Element Timing, Chromium)
// <img elementtiming="first-post-image" src="...">
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) send({ name: e.identifier, value: Math.round(e.renderTime || e.loadTime) });
}).observe({ type: 'element', buffered: true });
```

SSR 페이지는 콘텐츠가 HTML에 이미 있으므로, 하이드레이션 뒤에 `mark`를 찍으면 늦게 잡힌다. 서버에서 그린 요소는 Element Timing(`elementtiming` 속성)으로 실제 렌더 시각을 재는 편이 정확하다. Element Timing은 Chromium에서만 동작하므로 다른 브라우저 값은 비어 있다.

## 6. 실사용 수집

`examples/web-vitals.js`: `web-vitals` 라이브러리(v6.2.3에서 확인, v5에서 `onFID` 제거)로 LCP, INP, CLS, FCP, TTFB와 원인 힌트(attribution)를 모아 페이지가 숨겨질 때 `navigator.sendBeacon`으로 보낸다. 서버에서는 라우트 템플릿(`/post/:id`)별로 75번째 백분위수를 집계한다.

## 7. Lighthouse CI

`examples/lighthouserc.json`은 LCP 2.5초, CLS 0.1을 실패 조건으로, TBT 200ms, FCP 1.8초, 서버 응답 800ms, 요청 수 50개를 경고 조건으로, 스크립트 전송량 170KB(174080바이트)를 실패 조건으로 둔다. `resource-summary:<종류>:size|count` 형식의 크기 단위는 바이트다 ([설정 문서](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)).

```bash
npx @lhci/cli autorun --config=./lighthouserc.json
```

결과 업로드 대상을 `temporary-public-storage`로 바꾸면 보고서가 공개 URL로 며칠 동안 올라간다. 비공개 사이트는 `filesystem`이나 자체 LHCI 서버를 쓴다.

Lighthouse 13은 Node 22.19 이상이 필요하다. Node 20에서는 `lighthouse@12`를 쓴다(`lh-compare.mjs`가 자동으로 고른다).

## 8. PageSpeed Insights API와 CrUX

```bash
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com%2F&strategy=mobile&category=performance&key=$PSI_KEY" > psi.json
```

- `strategy`를 빼면 데스크톱이다. 모바일은 직접 지정한다.
- 키 없이도 부를 수 있지만 공유 할당량이라 금방 `429 Quota exceeded`가 난다(2026-11-24 시험에서 발생). API 키를 쓴다.
- 실사용 값: `loadingExperience.metrics`(해당 URL)와 `originLoadingExperience.metrics`(출처 전체). 각 지표에 `percentile`(p75)과 `category`(FAST/AVERAGE/SLOW)가 있다. `loadingExperience.origin_fallback`이 true면 URL 데이터가 부족해 출처 값으로 대신한 것이다.
  ```bash
  node -e 'const r=require("./psi.json");const m=r.loadingExperience?.metrics||{};for(const k in m)console.log(k,m[k].percentile,m[k].category);console.log("origin_fallback:",r.loadingExperience?.origin_fallback)'
  ```
  문서에 나온 키는 `INTERACTION_TO_NEXT_PAINT`, `FIRST_CONTENTFUL_PAINT_MS`다. LCP, CLS 키 이름과 CLS 값의 배율(100배로 나오는지)은 공식 문서에서 확인하지 못했으므로 위처럼 키 목록을 출력해 확인한다.
- Google은 PSI API의 CrUX 데이터 제공을 중단할 계획이라고 밝혔다. 실사용 데이터는 CrUX API를 쓴다 ([PSI 문서](https://developers.google.com/speed/docs/insights/v5/get-started)).

CrUX API (키 필수):

```bash
curl -s -X POST "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","formFactor":"PHONE","metrics":["largest_contentful_paint","interaction_to_next_paint","cumulative_layout_shift","experimental_time_to_first_byte"]}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).record?.metrics||{};for(const k in m)console.log(k,m[k].percentiles?.p75)})'
```

URL 단위 데이터가 없으면 `"url"` 대신 `"origin":"https://example.com"`으로 묻는다. CLS p75는 소수 둘째 자리 문자열로 온다 ([CrUX API 문서](https://developer.chrome.com/docs/crux/api)).

## 9. 성능 PR 규칙

- 제목이나 본문에 대상 지표와 전후 수치(중앙값, 실행 횟수, 프로파일)를 적는다.
- 나빠진 지표를 같이 적는다. 예: "FCP -1.2초, 하이드레이션 완료 +0.4%".
- 측정 명령을 그대로 붙여 재현할 수 있게 한다.
- `perf` 라벨을 달아 나중에 성능 변경만 모아 볼 수 있게 한다.
- 실사용 확인은 배포 2~4주 뒤 후속 기록으로 남긴다.
