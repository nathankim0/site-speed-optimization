# 캐시 설계

공개 페이지가 느리면 계산을 빠르게 만들기 전에 계산을 건너뛸 방법부터 찾는다. 이 문서는 캐시 계층, 헤더 레시피, 개인화 분리, TTL, 무효화, 캐시 키, CDN별 차이, 적중률 분석을 다룬다.

문서 확인일: 2026-11-24. CDN 동작은 자주 바뀌므로 적용 전에 아래 링크의 공식 문서를 다시 본다.

## 1. 4계층 구조

| 계층 | 하는 일 | 대표 도구 |
|---|---|---|
| CDN | 사용자와 가까운 엣지에서 공개 HTML과 자산을 바로 돌려준다 | CloudFront, Cloudflare, Fastly, Vercel |
| 웹서버 정적 HTML | 오래된 페이지를 압축 HTML 파일로 두고 앱을 거치지 않고 응답한다 | Nginx `try_files` + `gzip_static` |
| 웹서버 마이크로캐시 | 같은 요청이 몰리는 몇 초~수십 초 동안 앱 실행을 막는다 | Nginx `proxy_cache` 15초 |
| 앱 캐시 | 앱까지 온 요청의 조회와 조합 비용을 줄인다 | 메모리, Redis, 프레임워크 데이터 캐시 |
| DB | 위 계층을 모두 지난 요청만 도달한다 | |

요청이 아래로 내려갈수록 비싸다. 고칠 위치는 "이 요청이 왜 이 계층까지 내려왔는가"로 정한다.

## 2. 페이지 유형별 Cache-Control 레시피

| 유형 | 헤더 예시 | 이유 |
|---|---|---|
| 공개 HTML, 자주 바뀜 (첫 화면, 새 글 목록) | `Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=30` | 브라우저는 매번 확인하고, CDN은 15초 동안 몰린 요청을 한 번으로 줄인다 |
| 공개 HTML, 오래된 글 | `Cache-Control: public, max-age=60, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=86400` | 같은 URL이 다시 요청되는 간격이 길어서 TTL도 길어야 적중한다 |
| 해시된 정적 자산 (`app.3f2a1c.js`) | `Cache-Control: public, max-age=31536000, immutable` | 파일명이 바뀌면 새 URL이 되므로 1년 캐시가 안전하다 |
| 개인화 API (`/api/me`, 장바구니 수량) | `Cache-Control: private, no-store` | 공유 캐시와 브라우저 디스크 어디에도 남기지 않는다 |
| 로그인, 결제, 계정 페이지 | `Cache-Control: private, no-store` | 개인정보가 섞인 HTML이다 |

지시어 사용 기준:

- `s-maxage`: CDN 같은 공유 캐시에만 적용되는 수명이다. 브라우저 수명(`max-age`)과 따로 잡을 때 쓴다 ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)).
- `stale-while-revalidate=N`: 만료 뒤 N초 동안 오래된 응답을 먼저 주고 뒤에서 갱신한다 ([RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html)). Cloudflare, CloudFront, Fastly, Vercel, Nginx(1.11.10+) 모두 지원한다. 단, Cloudflare 문서는 `s-maxage`와 함께 쓰지 말라고 안내한다. Cloudflare 뒤라면 아래 `CDN-Cache-Control`로 나눈다.
- `stale-if-error=N`: 원점이 5xx를 내거나 닿지 않을 때 N초 동안 오래된 응답을 준다. 장애 대비용이다.
- `CDN-Cache-Control` ([RFC 9213](https://www.rfc-editor.org/rfc/rfc9213.html)): CDN만 읽는 별도 헤더다. 이 헤더가 유효하면 대상 CDN은 `Cache-Control`을 무시한다. 브라우저에는 `max-age=0`, CDN에는 1시간처럼 따로 주고 싶을 때 쓴다. Cloudflare와 Vercel은 지원한다. CloudFront 문서에는 언급이 없으므로 기대하지 않는다.
- `Vary`: 응답이 어떤 요청 헤더에 따라 달라지는지 알린다. `Vary: Accept-Encoding`은 정상이다. `Vary: Cookie`는 쿠키 값마다 캐시를 나눠 적중률이 사라진다. Vercel은 `Vary: Cookie` 응답을 아예 캐시하지 않는다. `Vary: *`는 공유 캐시를 끈다.
- `immutable` ([RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html)): 브라우저가 수명 동안 재검증 요청을 보내지 않게 한다. Cloudflare 같은 공유 캐시에는 효과가 없다.

## 3. 개인화 분리 패턴

로그인 쿠키가 있다고 페이지 전체 캐시를 우회하면, 로그인 사용자가 많은 서비스에서 캐시는 거의 쓸모가 없다. 페이지에서 사람마다 다른 부분은 대개 작다.

1. 공개 HTML은 세션을 읽지 않고 만든다. 제목, 본문, 댓글, 상품 정보처럼 모두에게 같은 내용만 넣는다.
2. 로그인 상태, 좋아요 여부, 장바구니 수량처럼 작은 개인 데이터는 페이지가 뜬 뒤 `no-store` API로 받는다.
3. 직전 값을 `localStorage`에 잠깐 저장해 먼저 그리고, API 응답이 오면 맞춘다. 깜빡임이 줄어든다.
4. 화면 설계도 캐시에 맞춘다. 헤더에 사용자 이름과 포인트를 찍는 대신 공통 아이콘을 두고, 누르면 개인 메뉴를 연다.

일반 JS 예시:

```html
<!-- 공개 HTML: 세션 없이 생성, 캐시 가능 -->
<button id="like" data-post="123" aria-pressed="false">좋아요</button>
<a id="account" href="/login" aria-label="계정">👤</a>
<script type="module">
  const KEY = 'me:v1';
  const MAX_AGE = 5 * 60 * 1000; // 5분 지난 값은 먼저 그리지 않는다
  function paint(me) {
    document.getElementById('account').href = me.loggedIn ? '/me' : '/login';
    const liked = me.likes?.includes(123);
    document.getElementById('like').setAttribute('aria-pressed', String(Boolean(liked)));
  }
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.t < MAX_AGE) paint(cached.me);
  } catch {}
  const res = await fetch('/api/me?post=123', { credentials: 'include', cache: 'no-store' });
  if (res.ok) {
    const me = await res.json();
    paint(me);
    try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), me })); } catch {}
  }
</script>
```

React 예시:

```jsx
import { useEffect, useState } from 'react';

const KEY = 'me:v1';
function readCached() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && Date.now() - c.t < 5 * 60 * 1000 ? c.me : null;
  } catch { return null; }
}

export function useMe() {
  // 서버 렌더링과 첫 하이드레이션은 항상 null로 시작한다 (공개 HTML과 일치).
  const [me, setMe] = useState(null);
  useEffect(() => {
    const cached = readCached();
    if (cached) setMe(cached);
    const ctrl = new AbortController();
    fetch('/api/me', { credentials: 'include', cache: 'no-store', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh) => {
        if (!fresh) return;
        setMe(fresh);
        try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), me: fresh })); } catch {}
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  return me; // null이면 공통 아이콘, 값이 오면 개인 메뉴
}
```

`/api/me` 응답 헤더는 `Cache-Control: private, no-store`다. 로그아웃할 때 `localStorage` 값도 지운다. 민감한 값(이메일, 주소, 잔액)은 `localStorage`에 넣지 않는다.

## 4. 콘텐츠 나이별 TTL

TTL은 "얼마나 오래 두어도 되는가"만으로 정하지 않는다. 같은 URL이 다시 요청되는 간격보다 TTL이 짧으면 캐시는 매번 비어 있다. 오래된 글은 하루에 한두 번 읽히므로 15초 TTL로는 거의 적중하지 않는다.

GeekNews가 쓰는 값 ([출처](https://hada.io/blog/geeknews-cache-on-a-budget/), 자세한 수치는 `case-studies.md`):

| 대상 | TTL |
|---|---|
| 첫 화면, 새 글 목록, 1일 미만 글 | 수십 초 |
| 토픽 1~3일 | 1분 |
| 토픽 3~30일 | 1시간 |
| 토픽 30일 이상 | CDN 24시간 + 정적 HTML |
| 날짜별 아카이브 7일 미만 | 3분 |
| 날짜별 아카이브 7~30일 | 1시간 |
| 날짜별 아카이브 30일 이상 | 24시간 |

정적 HTML은 모든 페이지를 미리 만들지 않는다. 실제로 요청된 오래된 페이지를 첫 요청 때 파일로 저장하고, 오래 요청되지 않은 파일은 지운다.

## 5. 무효화

- 바뀐 URL과 그 캐시 키만 지운다. 전체 퍼지는 쓰지 않는다. 전체 퍼지 직후에는 모든 요청이 원점으로 몰린다.
- 투표, 좋아요, 조회수처럼 잦고 본문을 다시 만들 필요가 없는 동작은 CDN 캐시를 지우지 않는다. 개수는 개인화 API나 짧은 TTL로 맞춘다.
- 삭제, 신고 처리, 개인정보 노출 같은 예외만 해당 URL을 즉시 지운다.
- 작성자에게는 글을 쓴 직후 한 번만 캐시를 우회한 화면을 보여준다. 예: 쓰기 요청 응답에서 짧게 사는 쿠키(`fresh=1; Max-Age=10`)를 주고, 그 쿠키가 있는 요청만 캐시를 건너뛴다. 다른 사람에게 몇 초 늦게 보이는 것은 감수한다.
- 정적 자산은 지우지 않고 파일명 해시를 바꾼다.
- 계층마다 지울 대상이 다르다: 앱 캐시 키, Nginx 마이크로캐시 키, 정적 HTML 파일, CDN URL. 한 곳만 지우면 다른 계층이 옛 내용을 다시 채운다. 지우는 순서는 안쪽(앱)에서 바깥쪽(CDN)이다.
- CDN 퍼지 API: Cloudflare는 URL, 태그, 호스트, 접두사 단위를 지원한다 ([문서](https://developers.cloudflare.com/cache/how-to/purge-cache/)). 태그는 `Cache-Tag` 응답 헤더로 붙인다. Next.js의 `revalidateTag`/`revalidatePath`는 Next.js 데이터 캐시만 지우고, 자체 호스팅 앞단 CDN은 따로 지워야 한다 ([문서](https://nextjs.org/docs/app/guides/cdn-caching)).

## 6. 캐시 키 정규화

같은 페이지가 여러 키로 쪼개지면 적중률이 떨어진다.

- 쿼리 파라미터 순서를 정렬한다 (`?b=2&a=1`과 `?a=1&b=2`를 같게).
- 추적 파라미터(`utm_*`, `fbclid`, `gclid`)를 키에서 뺀다. 분석 스크립트는 브라우저에서 URL을 읽으므로 서버 키에 필요 없다.
- 기본값을 지운다 (`?page=1`을 `/list`로). 앱에서 301로 정식 URL을 보내거나 CDN에서 키만 정규화한다.
- 쿠키는 키에 넣지 않는다. 넣는 순간 사용자마다 캐시가 나뉜다. 언어나 A/B 그룹처럼 값이 몇 개뿐인 쿠키만 예외로 검토한다.
- 헤더(`Accept-Language`, `User-Agent`)도 꼭 필요할 때만 키에 넣고, 넣는다면 값을 몇 개로 줄여서 넣는다.

## 7. CDN별 주의점

| 항목 | Cloudflare | CloudFront | Fastly | Vercel |
|---|---|---|---|---|
| HTML 기본 캐시 | 안 함. 확장자 기준이라 Cache Rule로 "Eligible for cache"를 켜야 함 | 캐시 정책 TTL을 따름. Minimum TTL이 0보다 크면 `no-store`/`private`도 캐시함 | 기본 TTL 2분으로 캐시 | `s-maxage`가 있으면 캐시 |
| `Set-Cookie` 응답 | 기본 설정에서는 쿠키를 지우고 캐시할 수 있고, `Cloudflare-CDN-Cache-Control`을 쓰면 캐시하지 않음 (두 문서의 서술이 다르므로 실제로 확인) | 쿠키를 원점에 전달하면 `Set-Cookie`까지 캐시해서 모든 HIT에 내보냄. 전달하지 않으면 `Set-Cookie`를 지움 | 기본 VCL이 캐시하지 않음(pass) | 캐시하지 않음 |
| `CDN-Cache-Control` | 지원 (`Cloudflare-CDN-Cache-Control`이 우선) | 문서에 없음 | `Surrogate-Control` 사용 | 지원 (`Vercel-CDN-Cache-Control`이 우선) |
| 쿠키를 키에서 빼기 | 기본 키에 쿠키 없음. 쿠키를 키에 넣는 기능은 Enterprise | 캐시 정책에서 쿠키 "None" | 기본 키에 쿠키 없음 | 기본 키에 쿠키 없음 |
| 상태 헤더 | `cf-cache-status`: HIT, MISS, EXPIRED, STALE, UPDATING, REVALIDATED, BYPASS, DYNAMIC | `x-cache`: Hit / RefreshHit / Miss from cloudfront (헤더 문자열은 AWS 지식 센터 기준) | `x-cache`: HIT 또는 MISS (pass도 MISS로 보임) | `x-vercel-cache`: HIT, MISS, STALE, PRERENDER, REVALIDATED, BYPASS |

공식 문서:
- Cloudflare: [기본 캐시 동작](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), [Cache-Control 처리](https://developers.cloudflare.com/cache/concepts/cache-control/), [CDN-Cache-Control](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/), [Cache Rules 설정](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/), [HTML 캐시 예제](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/cache-everything/)
- CloudFront: [쿠키 기반 캐시](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html), [만료와 TTL](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html), [관리형 캐시 정책](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)
- Fastly: [캐시 신선도](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/cache-freshness/), [X-Cache](https://www.fastly.com/documentation/reference/http/http-headers/X-Cache/)
- Vercel: [Cache-Control 헤더](https://vercel.com/docs/caching/cache-control-headers), [CDN 캐시 조건](https://vercel.com/docs/caching/cdn-cache)

공통 결론: 공개 HTML에는 `Set-Cookie`를 붙이지 않는다. CDN마다 "캐시 안 함", "쿠키를 지우고 캐시", "쿠키까지 캐시" 중 하나로 다르게 반응하고, 세 번째는 사고다. `scripts/check-cache.sh`가 HIT 응답의 쿠키 값이 반복되는지 확인한다.

## 8. 적중률 분석

- 전체 평균 적중률은 문제 위치를 숨긴다. 페이지 종류(첫 화면, 글, 목록, 아카이브)와 콘텐츠 나이로 쪼개서 본다.
- 고칠 순서는 `요청량 × 미스율 × 원점 비용`이 큰 경로부터다. 적중률이 0%라도 요청이 적고 원점이 싸면 미룬다.
- 조회수와 캐시 결과는 CDN 접근 로그에서 배치로 집계한다. 페이지를 볼 때마다 DB에 쓰면 측정이 서비스를 느리게 만든다. 날짜, 페이지 종류, 기기, 캐시 결과, 콘텐츠 나이 같은 작은 집계만 저장한다.
- 원점 비용은 앱 로그의 처리 시간(p50, p95)으로 잰다.

집계 예시 (자리표시자. CloudFront 표준 로그를 DuckDB로 읽는다고 가정했고, `columns={...}`에는 로그 형식 문서의 필드 목록을 넣는다):

```sql
SELECT
  regexp_extract(cs_uri_stem, '^/([a-z]+)', 1)        AS page_type,
  count(*)                                              AS requests,
  avg(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN 1 ELSE 0 END) AS hit_rate,
  count(*) * (1 - avg(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN 1 ELSE 0 END)) AS origin_requests
FROM read_csv('logs/*.gz', delim='\t', header=false, columns={...})
GROUP BY 1
ORDER BY origin_requests DESC;
```

`origin_requests`에 경로별 원점 처리 시간을 곱하면 우선순위가 나온다.
