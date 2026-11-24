# 스택별 적용

스택마다 "공개 HTML 캐시 / 개인화 분리 / 무효화 / 측정 포인트" 순서로 정리했다. 문서 확인일은 2026-11-24이고, 버전마다 API가 다르면 버전을 적었다. 적용 전에 프로젝트의 실제 버전(`package.json`, lockfile)을 먼저 확인한다.

## Next.js (App Router)

현재 안정 버전은 16.4(2026-10-06)다. 15와 16 사이에 캐시 기본값과 API가 크게 바뀌었다.

**버전 확인 먼저.**

| 항목 | 14 | 15 | 16 |
|---|---|---|---|
| `fetch` 기본 캐시 | 캐시함 (15 업그레이드 가이드 기준, 14 문서는 미확인) | 캐시 안 함 | 캐시 안 함 |
| `cookies()`, `headers()` | 동기 | 비동기 (동기 접근은 경고) | 비동기만 |
| `"use cache"`, `cacheLife`, `cacheTag` | 없음 | 실험 기능 | 안정 (`cacheComponents: true`) |
| PPR | 실험 | `experimental.ppr` | Cache Components에 포함, `experimental.ppr` 제거 |

**공개 HTML 캐시 (Cache Components 미사용).**

```ts
// app/post/[id]/page.tsx
export const revalidate = 60; // 정적 분석 가능한 숫자만. 60 * 10 같은 식은 안 됨

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await fetch(`https://api.example.com/posts/${id}`, {
    next: { revalidate: 60, tags: [`post:${id}`] },
  }).then((r) => r.json());
  return <Article post={post} />;
}
```

- 이 페이지는 ISR이 되고, 자체 호스팅 시 `Cache-Control: s-maxage=60, stale-while-revalidate=<expire - 60>`이 나간다 ([CDN 캐시 문서](https://nextjs.org/docs/app/guides/cdn-caching)).
- 라우트 안에서 `cookies()`나 `headers()`, `searchParams`를 읽으면 동적 렌더링이 되고 `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`가 나간다. 레이아웃 한 곳에서 쿠키를 읽어도 그 아래 모든 페이지가 동적이 된다. 공개 페이지 트리에서는 쿠키를 읽지 않는다.

**공개 HTML 캐시 (Next.js 16, Cache Components).**

```ts
// next.config.ts
export default { cacheComponents: true };
```

```tsx
import { cacheLife, cacheTag } from 'next/cache';

async function getPost(id: string) {
  'use cache';
  cacheLife('hours');            // stale 5분, revalidate 1시간, expire 1일
  cacheTag(`post:${id}`);
  return fetch(`https://api.example.com/posts/${id}`).then((r) => r.json());
}
```

- 내장 프로필(stale / revalidate / expire): `seconds` 30초/1초/1분, `minutes` 5분/1분/1시간, `hours` 5분/1시간/1일, `days` 5분/1일/1주, `weeks` 5분/1주/30일, `max` 5분/30일/1년, `default` 5분/15분/무기한 ([cacheLife](https://nextjs.org/docs/app/api-reference/functions/cacheLife)).
- `"use cache"` 안에서는 `cookies()`/`headers()`를 읽을 수 없다. 밖에서 읽어 인자로 넘긴다. 사용자별 결과를 캐시하려면 `"use cache: private"`(서버 캐시에 저장하지 않음)를 쓴다.
- Cache Components를 켜면 라우트 설정 `dynamic`, `revalidate`, `fetchCache`는 제거된다. Node.js 런타임이 필요하다 ([cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)).
- PPR은 Cache Components의 기본 동작이다. 정적 셸은 미리 만들고 `<Suspense>` 안의 동적 부분만 요청 때 채운다. 개인화 영역을 `<Suspense>`로 감싸면 공개 셸은 캐시된다.

**개인화 분리.** 사용자 정보는 클라이언트 컴포넌트에서 `/api/me`(Route Handler, `Cache-Control: private, no-store`)로 받거나, Cache Components에서 `<Suspense>` 안 동적 컴포넌트로 분리한다. 레이아웃에서 세션을 읽어 헤더에 이름을 찍는 패턴이 공개 페이지 전체를 동적으로 만드는 가장 흔한 원인이다.

**무효화.** 모두 `next/cache`에서 가져온다.

| API | 서명 (16) | 호출 위치 | 동작 |
|---|---|---|---|
| `revalidateTag` | `revalidateTag(tag, profile)` | Server Function, Route Handler | 16에서 두 번째 인자가 생겼다. `'max'`를 권장(stale-while-revalidate). `{ expire: 0 }`은 즉시 만료. 인자 하나 형태는 deprecated |
| `updateTag` | `updateTag(tag)` | Server Action만 | 즉시 만료시켜 작성자가 다음 요청에서 바로 새 값을 본다 (작성 직후 화면) |
| `revalidatePath` | `revalidatePath(path, type?)` | Server Function, Route Handler | 동적 세그먼트가 있으면 `type`(`'page'`/`'layout'`) 필수 |
| `refresh` | `refresh()` | Server Action만 | 캐시는 그대로 두고 현재 라우트의 동적 부분만 다시 실행 |

글 작성 Server Action에서는 `updateTag('post:123')`로 작성자 화면을 맞추고, 다른 사람에게는 `revalidateTag('topic:42', 'max')`로 뒤에서 갱신한다. 자체 호스팅이면 이 API들이 앞단 CDN을 지우지 않으므로 CDN 퍼지를 따로 호출한다.

**측정 포인트.** 자체 호스팅 응답의 `x-nextjs-cache`(HIT, STALE, MISS, REVALIDATED), `Cache-Control`이 `private, no-store`로 바뀌지 않았는지 `scripts/check-cache.sh`로 본다. 번들은 `npx next analyze`(16.1+).

## Cloudflare Workers / Pages

**공개 HTML 캐시.** Cloudflare는 기본으로 HTML을 캐시하지 않는다(확장자 기준). 두 방법이 있다.

1. 대시보드 Cache Rules: 공개 경로에 "Eligible for cache"를 켜고, Edge TTL은 "원점의 cache-control을 따름"으로 둔다. 이 규칙은 동적 내용이 있어도 HTML을 캐시하므로, 로그인/계정/API 경로를 표현식에서 빼야 한다 ([예제](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/cache-everything/)).
2. Worker 안에서 하위 요청에 `cf` 옵션을 준다 ([문서](https://developers.cloudflare.com/workers/runtime-apis/request/)).
   ```js
   const res = await fetch(originRequest, {
     cf: {
       cacheEverything: true,
       cacheTtlByStatus: { '200-299': 60, '404': 5, '500-599': 0 },
       cacheTags: [`post:${id}`],
     },
   });
   ```

Workers Cache API(`caches.default`)는 직접 응답을 넣고 꺼낼 때 쓴다. 저장한 데이터센터 안에서만 유효하고, `Set-Cookie`가 있는 응답은 저장되지 않으며, tiered cache와 함께 동작하지 않는다 ([문서](https://developers.cloudflare.com/workers/runtime-apis/cache/)). 전역 캐시가 필요하면 `fetch`의 `cf` 옵션이나 Cache Rules를 쓴다.

```js
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') return fetch(request);
    const cache = caches.default;
    let res = await cache.match(request);
    if (res) return res;
    res = await renderPublicPage(request, env);          // 세션을 읽지 않는 렌더
    res = new Response(res.body, res);
    res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    res.headers.delete('Set-Cookie');
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};
```

**개인화 분리.** `/api/me`는 캐시 규칙에서 빼고 `private, no-store`로 응답한다. `CDN-Cache-Control`이나 `Cloudflare-CDN-Cache-Control`로 브라우저와 엣지 수명을 나눌 수 있다. Cloudflare 문서는 `stale-while-revalidate`를 `s-maxage`와 같이 쓰지 말라고 하므로, 엣지 수명은 `Cloudflare-CDN-Cache-Control: max-age=60, stale-while-revalidate=30`처럼 둔다.

**무효화.** `POST https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache`에 `{"files": [...]}`, `{"tags": [...]}`, `{"prefixes": [...]}` 중 하나를 보낸다. 태그는 원점 응답의 `Cache-Tag` 헤더(쉼표 구분, 합계 16KB)로 붙인다. 모든 요금제에서 쓸 수 있고 요금제별 호출 한도가 있다 ([문서](https://developers.cloudflare.com/cache/how-to/purge-cache/)).

**DB 연결.** Hyperdrive와 Smart Placement는 `backend.md` 3절.

**측정 포인트.** `cf-cache-status`(HIT, MISS, EXPIRED, STALE, UPDATING, REVALIDATED, BYPASS, DYNAMIC). `DYNAMIC`이면 캐시 대상이 아니다. Smart Placement가 켜졌으면 `cf-placement` 헤더로 실행 위치를 본다(베타 이후 바뀔 수 있음).

## Vercel

**공개 HTML 캐시.** Vercel CDN은 `s-maxage`가 있으면 응답을 캐시한다(1초~1년). 헤더 우선순위는 `Vercel-CDN-Cache-Control` > `CDN-Cache-Control` > `Cache-Control`이다. `Cache-Control`만 쓰면 Vercel이 `s-maxage`와 `stale-while-revalidate`를 소비하고 브라우저에는 `public, max-age=0, must-revalidate`를 보낸다 ([문서](https://vercel.com/docs/caching/cache-control-headers)).

```js
// 함수 응답에서 브라우저와 CDN 수명 나누기
return new Response(html, {
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'max-age=60, stale-while-revalidate=300',
  },
});
```

캐시 조건: GET/HEAD, `Authorization` 헤더 없음, 상태 200/404/410/301/302/307/308, 10MB 이하, `Set-Cookie` 없음, `private`/`no-cache`/`no-store` 없음, `Vary: *`나 `Vary: Cookie` 없음 ([문서](https://vercel.com/docs/caching/cdn-cache)). 하나라도 어기면 조용히 캐시되지 않는다.

**ISR.** Next.js의 `revalidate`/`"use cache"`는 Vercel에서 리전별 내구 캐시로 동작한다. 배포마다 캐시가 따로 있고, 퍼지는 300ms 안에 전 리전에 퍼진다. 동시 MISS는 리전당 한 번의 실행으로 합쳐진다 ([ISR 문서](https://vercel.com/docs/incremental-static-regeneration)).

**개인화 분리.** 위 Next.js와 같다. 미들웨어나 레이아웃에서 쿠키를 설정하면 그 응답은 캐시되지 않는다.

**측정 포인트.** `x-vercel-cache`: HIT, MISS, STALE, PRERENDER(정적 저장소), REVALIDATED(앞단에서 다시 만듦), BYPASS.

## Nginx + CloudFront (또는 다른 CDN)

**공개 HTML 캐시.** 원점 Nginx는 `examples/nginx-microcache.conf`를 따른다: 오래된 페이지는 정적 HTML 파일(`try_files` + `gzip_static`), 나머지는 15초 마이크로캐시(`proxy_cache_lock`, `proxy_cache_use_stale updating`, `proxy_cache_background_update`). 앞단 CloudFront는 원점의 `Cache-Control`을 따르는 캐시 정책을 쓴다.

**CloudFront 캐시 정책에서 정할 것.**
- 캐시 키의 쿠키: 공개 HTML 동작(behavior)은 "None". 쿠키를 원점에 넘기면 CloudFront는 원점의 `Set-Cookie`까지 캐시해 모든 HIT에 내보낸다. 넘기지 않으면 `Set-Cookie`를 지운다 ([문서](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html)).
- 캐시 키의 쿼리 문자열: 페이지를 바꾸는 파라미터(`page`, `sort`)만 허용 목록으로 넣는다. `utm_*`는 넣지 않는다.
- 원점에만 보내고 키에는 넣지 않을 값은 origin request policy로 넘긴다. 캐시 키에 넣은 값은 자동으로 원점에도 간다.
- TTL: Minimum TTL이 0보다 크면 원점이 `no-store`/`private`을 보내도 캐시한다. 관리형 `CachingOptimized`는 Minimum TTL이 1초다. 개인화 경로는 `UseOriginCacheControlHeaders`(최소 0) 같은 정책으로 분리한다 ([TTL 문서](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)).
- `stale-while-revalidate`와 `stale-if-error`를 지원한다(Maximum TTL이 상한).

**개인화 분리.** `/api/me*` 동작(behavior)을 따로 만들고 쿠키를 원점에 넘기며 캐시하지 않는 정책을 붙인다.

**무효화.** CloudFront invalidation은 경로 단위(`/post/123`, `/topic/*`)다. 원점 Nginx 캐시 키와 정적 HTML 파일을 먼저 지우고 CloudFront를 지운다. 잦은 갱신은 퍼지보다 짧은 TTL로 해결한다.

**측정 포인트.** `x-cache`(Hit/RefreshHit/Miss from cloudfront), `age`, 원점의 `X-Cache-Status`(Nginx `$upstream_cache_status`). 표준 로그의 `x-edge-result-type`으로 적중률을 집계한다(`caching.md` 8절).

## Astro

- 기본은 정적 생성이다. 요청 때 렌더링하는 페이지(서버 어댑터 사용)는 `Astro.response.headers.set('Cache-Control', 'public, s-maxage=60')`로 캐시 헤더를 준다. 어댑터와 버전에 따라 `export const prerender` 설정 방식이 다르니 프로젝트의 Astro 버전 문서를 확인한다(확인 필요).
- 개인화는 아일랜드(클라이언트 컴포넌트)나 서버 아일랜드로 분리해 페이지 셸을 캐시 가능하게 둔다.
- JS가 기본 0이라 프론트엔드 문제는 이미지, 폰트, 서드파티 쪽이 많다.

## Remix / React Router (프레임워크 모드)

- 라우트 모듈의 `loader`가 렌더링 전에 병렬로 데이터를 받는다. 컴포넌트 안 `useEffect` 요청을 `loader`로 옮기는 것이 첫 번째 개선이다.
- 라우트 모듈에서 `headers` 함수를 내보내 `Cache-Control`을 지정한다. 중첩 라우트는 가장 깊은 라우트의 헤더가 이기므로, 부모의 짧은 TTL을 고려해 정한다(정확한 병합 규칙은 사용하는 버전 문서 확인 필요).
- 세션은 `loader`에서만 읽고, 공개 라우트의 `loader`는 세션을 읽지 않게 나눈다.
