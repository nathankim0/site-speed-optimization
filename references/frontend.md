# 프론트엔드 최적화

브라우저 쪽에서 LCP, CLS, INP와 JS 비용을 줄이는 방법이다. 브라우저 지원 범위는 2026-11-24 기준이며, 쓰기 전에 링크를 다시 확인한다.

## 1. LCP

- LCP 이미지는 `loading="lazy"`를 붙이지 않는다. 화면 밖 이미지만 lazy로 둔다.
- LCP 이미지에 `fetchpriority="high"`를 붙인다. Chrome/Edge 102, Firefox 132, Safari 17.2부터 지원한다. 힌트일 뿐 강제는 아니다 ([web.dev](https://web.dev/articles/fetch-priority)).
- 이미지가 CSS 배경이거나 JS가 넣는 경우처럼 HTML에서 늦게 발견되면 preload한다.
  ```html
  <link rel="preload" as="image" href="/hero-800.avif"
        imagesrcset="/hero-400.avif 400w, /hero-800.avif 800w, /hero-1600.avif 1600w"
        imagesizes="100vw" fetchpriority="high">
  ```
  preload는 대역폭을 나눠 쓴다. 트레이스에서 늦게 발견된 리소스에만 쓴다.
- `srcset`/`sizes`로 화면 크기에 맞는 파일을 고르게 하고, AVIF나 WebP를 쓴다.
  ```html
  <picture>
    <source type="image/avif" srcset="/p-400.avif 400w, /p-800.avif 800w" sizes="(max-width: 600px) 100vw, 600px">
    <img src="/p-800.jpg" srcset="/p-400.jpg 400w, /p-800.jpg 800w" sizes="(max-width: 600px) 100vw, 600px"
         width="800" height="600" alt="" fetchpriority="high">
  </picture>
  ```
- 선택: 103 Early Hints. HTML 생성이 느리고 필요한 하위 리소스가 정해져 있을 때, 최종 응답 전에 `Link: </app.css>; rel=preload; as=style`를 먼저 보낸다. preload는 Chrome/Edge 103+, Firefox 123+에서 동작하고 Safari는 preconnect만 지원한다. 내비게이션 요청에만 적용되고 HTTP/2 이상을 권장한다. preload하는 리소스는 캐시 가능해야 두 번 받지 않는다. Cloudflare, Fastly, Akamai가 지원한다 ([Chrome 문서](https://developer.chrome.com/docs/web-platform/early-hints)).

## 2. CLS

- `<img>`, `<video>`, `<iframe>`에 `width`/`height`를 적거나 CSS `aspect-ratio`를 준다.
- 광고, 배너, 쿠키 동의, "새 글 있음" 알림처럼 나중에 들어오는 영역은 자리를 미리 잡는다 (`min-height`). 위에 끼워 넣지 말고 아래나 오버레이로 띄운다.
- 웹폰트가 바뀔 때 생기는 흔들림은 대체 폰트 크기를 맞춰 줄인다.
  ```css
  @font-face {
    font-family: "Brand Fallback";
    src: local("Arial");
    size-adjust: 104%;        /* 실제 값은 두 폰트를 비교해 정한다 */
    ascent-override: 92%;
    descent-override: 24%;
  }
  body { font-family: "Brand", "Brand Fallback", system-ui, sans-serif; }
  ```
  `size-adjust`는 모든 주요 브라우저가 지원한다. `ascent-override`/`descent-override`는 Safari 정식판이 지원하지 않는다 ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust), [Chrome 글](https://developer.chrome.com/blog/font-fallbacks)).

## 3. INP

- 50ms를 넘는 긴 작업을 쪼개 브라우저가 중간에 입력을 처리하게 한다. `scheduler.yield()`는 Chrome/Edge 129+, Firefox 142+에서 지원하고 Safari는 지원하지 않는다 ([web.dev](https://web.dev/articles/optimize-long-tasks)).
  ```js
  function yieldToMain() {
    if (globalThis.scheduler?.yield) return scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  let start = performance.now();
  for (const item of items) {
    process(item);
    if (performance.now() - start > 40) { await yieldToMain(); start = performance.now(); }
  }
  ```
- 하이드레이션 비용을 줄인다: 화면에 보이지 않거나 상호작용이 없는 영역은 서버 컴포넌트나 정적 HTML로 두고 클라이언트 JS를 보내지 않는다. 큰 목록은 가상화한다.
- React에서 급하지 않은 갱신은 `useTransition`/`startTransition`으로 감싸 입력 반응을 먼저 그리게 한다.
- 이벤트 핸들러 안에서는 화면 갱신에 필요한 일만 하고, 로깅과 분석 전송은 `requestIdleCallback`이나 다음 작업으로 미룬다.

## 4. JS

**초기 파일 수.** 번들 용량만큼 파일 개수도 중요하다. HTTP/2 표준(RFC 9113)은 동시 스트림 한도를 100 이상으로 두라고 권장하고, 실제 서버와 CDN도 100 근처를 많이 쓴다. 시작할 때 수백 개 모듈을 따로 받으면 한도에 걸려 왕복이 늘어난다. X는 초기 JS 파일을 로그인 754개에서 182개로, 비로그인 582개에서 10개로 줄였고, JS 응답마다 275ms 지연을 준 시험에서 홈 표시가 6.63초에서 4.95초가 됐다.

**청크 묶는 기준은 배포 주기다.**
1. 외부 의존성: 거의 바뀌지 않아 브라우저 캐시에 오래 남는다.
2. 자체 코드: 배포마다 일부 바뀐다.
3. lazy 청크 이름을 참조하는 코드(라우트 매니페스트 등): 배포마다 반드시 바뀐다. 작게 분리해 나머지 청크의 해시가 흔들리지 않게 한다.

**로그인/비로그인 진입점 분리.** 비로그인 페이지는 비로그인 코드만 받게 한다. 로그인 전용 기능(작성기, 알림, 메시지)은 동적 import로 뺀다.

**Vite 8 (Rolldown) 예시.** Vite 8부터 `build.rollupOptions`는 `build.rolldownOptions`가 되고, 객체형 `manualChunks`는 지원하지 않는다 ([마이그레이션 가이드](https://vite.dev/guide/migration), [codeSplitting](https://rolldown.rs/reference/OutputOptions.codeSplitting)).

```js
// vite.config.js (Vite 8)
export default {
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
};
```

Vite 7 이하(Rollup)는 함수형 `manualChunks`를 쓴다.

```js
// vite.config.js (Vite 7 이하)
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
};
```

**Next.js 번들 분석.** Turbopack 분석기는 `npx next analyze`(16.1부터, 16.1 발표 당시 이름은 `next experimental-analyze`)로 연다. webpack 빌드는 `@next/bundle-analyzer`를 `ANALYZE=true npm run build`로 켠다. Next.js 16은 `next build` 출력에서 `First Load JS` 크기 표시를 뺐으므로 분석기나 Lighthouse의 `resource-summary`로 확인한다 ([문서](https://nextjs.org/docs/app/guides/package-bundling)).

## 5. 스트리밍 HTML에서는 `async` 모듈로

`defer` 스크립트와 기본 `type="module"`은 문서 파싱이 끝난 뒤 실행된다. 스트리밍 SSR에서는 가장 느린 Suspense 영역이 도착해야 파싱이 끝나므로, 그때까지 하이드레이션이 멈춘다. 진입 스크립트를 `async` 모듈로 두면 파일이 도착하는 즉시 실행돼 이미 그려진 영역부터 연결된다.

```html
<script type="module" async src="/entry.js"></script>
```

X 시험: 서버에 5초 지연을 넣었을 때 React는 589ms에 연결됐고 문서 파싱은 6,017ms에 끝났다. 스트리밍하지 않는 일반 페이지에서는 `defer`나 기본 모듈로 충분하다.

## 6. CSS 먼저, JS는 그다음

느린 망에서는 JS 다운로드가 렌더링을 막는 CSS와 대역폭을 나눠 쓴다. CSS 로드가 끝난 뒤 작은 인라인 스크립트로 JS 진입점과 preload를 추가하면 첫 화면이 빨라진다.

```html
<link rel="stylesheet" href="/app.css" id="main-css">
<script>
  (function () {
    var started = false;
    function boot() {
      if (started) return; started = true;
      var s = document.createElement('script');
      s.type = 'module'; s.src = '/entry.js'; s.async = true;
      document.head.appendChild(s);
    }
    var css = document.getElementById('main-css');
    // CSS가 실패해도(404, 차단) 앱은 떠야 하므로 error에서도 시작한다.
    if (css.sheet) boot();
    else { css.addEventListener('load', boot, { once: true }); css.addEventListener('error', boot, { once: true }); }
  })();
</script>
```

X는 비로그인 게시물 FCP가 7,216ms에서 1,804ms, 프로필이 3,064ms에서 1,984ms가 됐다. 대가로 5개 페이지 중 2개에서 하이드레이션 완료가 0.3%, 0.6% 늦어졌다. 전후 비교 때 하이드레이션 지표도 같이 기록한다.

## 7. 폰트

- 시스템 폰트를 먼저 검토한다 (`system-ui, -apple-system, "Segoe UI", sans-serif`).
- 웹폰트를 쓰면 woff2, 쓰는 글자만 남긴 서브셋, `font-display`를 지정한다. 본문은 `swap`(대체 폰트로 바로 그리고 나중에 교체), 레이아웃 흔들림을 더 싫어하면 `optional`(짧게 기다리고 못 받으면 이번 방문은 대체 폰트 유지)을 쓴다.
- 첫 화면에 쓰는 폰트 한두 개만 preload한다. 폰트 preload에는 같은 출처여도 `crossorigin`이 필요하다.
  ```html
  <link rel="preload" href="/fonts/brand-subset.woff2" as="font" type="font/woff2" crossorigin>
  ```
- 한국어 웹폰트는 글자 수가 많아 파일이 크다. `unicode-range`로 나눈 서브셋 파일을 쓰거나 본문은 시스템 폰트로 둔다.

## 8. 서드파티

1. 먼저 꼭 필요한지 묻는다. 쓰지 않는 태그, 중복 분석 도구를 지운다.
2. 필요하면 지연 로드한다: 첫 상호작용 뒤, 또는 `requestIdleCallback` 뒤에 넣는다.
3. 무거운 위젯은 파사드로 바꾼다: 유튜브 임베드는 썸네일 이미지와 재생 버튼만 두고 클릭할 때 iframe을 넣는다. 채팅 위젯도 버튼만 먼저 그린다.
4. 서드파티의 비용을 재려면 Lighthouse를 직접 실행해 `--blocked-url-patterns`로 서드파티를 막은 결과와 막지 않은 결과를 비교한다. `lh-compare.mjs`는 이 옵션을 넘기지 않는다.

## 9. i18n

기본 언어는 메시지 키를 그대로 화면 문자열로 쓰게 하면 기본 언어 카탈로그를 초기 경로에서 뺄 수 있다 (`t('Save')`가 키 겸 영어 문장). 다른 언어 카탈로그는 라우트나 언어별로 나눠 필요할 때 받는다. 무거운 ICU 메시지 파서는 실제로 쓰는 기능(복수형, 변수 치환)만 처리하는 작은 파서로 바꿀 수 있다. X는 영어 카탈로그 49.5KB(gzip)를 초기 경로에서 뺐고, 파서 교체로 진입점마다 약 8KB를 줄였다.

## 10. 빌드 플러그인이 넣는 코드 찾기

빌드 결과물을 직접 열어 본다. 모든 청크에 반복되는 문자열이 있으면 의심한다. X는 Sentry 빌드 플러그인이 211개 청크마다 release ID를 넣어 12.4KB가 늘어난 것을 찾았다.

```bash
# 청크마다 반복되는 긴 문자열 찾기 (dist/assets 기준)
grep -ohE '"[A-Za-z0-9_-]{24,}"' dist/assets/*.js | sort | uniq -c | sort -rn | head
```

## 11. 화면 전환

- 의도 기반 preload: 링크에 hover나 focus가 생기면 다음 라우트의 코드와 데이터를 받는다. 리스트 항목은 포인터가 100ms 머물거나 누를 때만 받는다. 스크롤 중 포인터 아래를 지나가는 항목까지 받으면 낭비다.
- Speculation Rules API로 브라우저에 prefetch/prerender를 맡길 수 있다.
  ```html
  <script type="speculationrules">
  { "prefetch": [{ "where": { "href_matches": "/post/*" }, "eagerness": "moderate" }] }
  </script>
  ```
  `moderate`는 데스크톱에서 200ms hover나 pointerdown에 반응한다. 지원: Chrome/Edge(prerender 109+, `eagerness` 121+), Safari 27.3+. Firefox는 163에서 부분 지원이며 범위는 확인 필요. 지원하지 않는 브라우저는 무시하므로 점진 적용이 가능하다. prerender는 분석 이벤트가 두 번 찍히지 않게 `document.prerendering`을 확인한다 ([Chrome 문서](https://developer.chrome.com/docs/web-platform/prerender-pages)).

## 12. bfcache (뒤로/앞으로 캐시)

- `unload` 핸들러를 쓰지 않는다. Firefox 데스크톱은 `unload` 리스너가 있으면 bfcache를 쓰지 않고, Chrome은 2026년 10월(Chrome 155)까지 `unload`를 기본으로 꺼 버렸다. 정리 작업은 `pagehide`나 `visibilitychange`에서 한다 ([Chrome 문서](https://developer.chrome.com/docs/web-platform/deprecating-unload)).
- HTML의 `Cache-Control: no-store`: Chrome은 이제 안전한 조건에서 no-store 페이지도 bfcache에 넣지만, 쿠키가 바뀌거나 no-store fetch 응답이 있으면 내보낸다. 다른 브라우저는 여전히 막을 수 있다. 진짜 개인 데이터가 아니면 `no-cache`나 `max-age=0`을 쓴다 ([Chrome 문서](https://developer.chrome.com/docs/web-platform/bfcache-ccns), [web.dev](https://web.dev/articles/bfcache)).
- 확인: DevTools > Application > Back/forward cache에서 테스트하고, `pageshow` 이벤트의 `event.persisted`로 실사용 비율을 잰다.
