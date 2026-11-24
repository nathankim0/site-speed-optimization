# 백엔드 최적화

캐시를 지나 원점까지 온 요청을 빠르게 만드는 방법이다. TTFB가 높고 캐시 MISS가 아니라면 여기서 원인을 찾는다.

## 1. 서로 의존하지 않는 요청은 병렬로

```js
// 느림: 직렬 (각 왕복이 더해짐)
const token = await getGuestToken();
const flags = await getFeatureFlags();
const user = await getUser(id);

// 빠름: 병렬 (가장 느린 하나만큼)
const [token, flags, user] = await Promise.all([getGuestToken(), getFeatureFlags(), getUser(id)]);
```

하나가 실패해도 나머지를 쓰려면 `Promise.allSettled`를 쓴다. X는 게스트 토큰과 기능 플래그 요청을 병렬로 바꿨다. 서버 렌더링 코드에서 `await`가 연달아 있으면 의존 관계가 진짜인지 하나씩 확인한다.

## 2. N+1과 느린 쿼리

**N+1 찾기.** 목록 하나를 그리는데 쿼리 수가 항목 수만큼 늘면 N+1이다. 개발 환경에서 요청당 쿼리 수를 로그로 남기고, 같은 모양의 쿼리가 반복되는지 본다. ORM의 eager loading(`include`, `with`, `prefetch_related`)이나 `WHERE id IN (...)` 한 번으로 바꾼다. GraphQL이면 DataLoader로 묶는다.

**쿼리 계획 보기.**

```sql
-- PostgreSQL: 실제 실행 시간과 버퍼 사용량
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM posts WHERE topic_id = 42 ORDER BY created_at DESC LIMIT 20;
-- MySQL 8.0.18+
EXPLAIN ANALYZE SELECT * FROM posts WHERE topic_id = 42 ORDER BY created_at DESC LIMIT 20;
```

`Seq Scan`(전체 스캔)이 큰 테이블에 나오거나, 예상 행 수와 실제 행 수가 크게 다르거나, `Sort`가 디스크를 쓰면 손볼 곳이다. `EXPLAIN ANALYZE`는 쿼리를 실제로 실행하므로 쓰기 쿼리는 트랜잭션 안에서 돌리고 롤백한다.

**인덱스 점검.** `WHERE`와 `ORDER BY`에 같이 쓰는 컬럼은 복합 인덱스로 둔다 (위 예: `(topic_id, created_at DESC)`). PostgreSQL은 `pg_stat_statements`로 총 실행 시간이 큰 쿼리부터 본다. 쓰지 않는 인덱스는 쓰기를 느리게 하므로 지운다.

**페이지네이션은 keyset으로.** `OFFSET 10000`은 앞의 1만 행을 읽고 버린다.

```sql
-- offset: 뒤로 갈수록 느려짐
SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 10000;
-- keyset: 마지막으로 본 값 다음부터
SELECT * FROM posts
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

## 3. 서버리스, 엣지와 DB

서버리스 함수는 인스턴스가 많고 수명이 짧아서 DB 연결이 금방 바닥난다. 함수가 DB와 먼 리전에서 돌면 쿼리마다 대륙 간 왕복이 붙는다.

- **커넥션 풀러.** Neon은 엔드포인트 ID에 `-pooler`를 붙인 호스트(예: `ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech`)로 연결하면 PgBouncer를 거친다. 트랜잭션 모드라서 SQL 수준 `PREPARE`, 세션 `SET`, `LISTEN/NOTIFY`, 임시 테이블, 세션 advisory lock을 쓸 수 없다. 프로토콜 수준 prepared statement는 된다. 마이그레이션과 `pg_dump`는 직접 연결로 한다 ([Neon 문서](https://neon.com/docs/connect/connection-pooling)). 자체 PgBouncer도 트랜잭션 모드에서 같은 제약이 있다.
- **HTTP 드라이버.** `@neondatabase/serverless`의 `neon()`은 쿼리를 HTTP로 보내 연결 수립 비용이 없다. 상호작용형 트랜잭션이 필요하면 같은 패키지의 `Pool`/`Client`(WebSocket)를 쓴다 ([문서](https://neon.com/docs/serverless/serverless-driver)).
  ```js
  import { neon } from '@neondatabase/serverless';
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT id, title FROM posts WHERE id = ${postId}`;
  ```
- **Cloudflare Hyperdrive.** Workers에서 기존 Postgres/MySQL로 가는 연결을 풀링하고, 읽기 쿼리를 기본으로 캐시한다(`max_age` 기본 60초, 최대 1시간). 쓰기와 `NOW()` 같은 함수가 들어간 쿼리는 캐시하지 않는다 ([문서](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)).
  ```jsonc
  // wrangler.jsonc
  { "compatibility_flags": ["nodejs_compat"], "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }] }
  ```
  ```js
  import { Client } from 'pg'; // pg 8.16.3 이상
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  ```
- **함수를 DB 가까이.** Cloudflare Smart Placement(`"placement": { "mode": "smart" }`)는 원점과 가까운 곳에서 Worker를 실행한다. fetch 핸들러에만 적용되고 분석에 최대 15분이 걸린다 ([문서](https://developers.cloudflare.com/workers/configuration/placement/)). Vercel, AWS Lambda는 함수 리전을 DB 리전과 같게 설정한다.

## 4. Node 이벤트 루프 지연

이벤트 루프가 CPU 작업(SSR 렌더링, 큰 JSON 처리)으로 막히면 이미 도착한 응답의 콜백보다 타이머가 먼저 실행될 수 있다. 상위 서비스는 빨리 답했는데 내 쪽 타임아웃이 터지는 가짜 타임아웃이 생긴다. X는 상위 서비스가 약 25ms 만에 응답했는데 비로그인 렌더의 1~9%에서 1초 타임아웃이 발생했다. 렌더 워커의 이벤트 루프는 중앙값 67%, p95 84% 시간 동안 바빴다.

타임아웃이 늘면 상위 서비스보다 렌더 워커의 이벤트 루프부터 본다.

```js
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 20 }); // 샘플 간격 ms
h.enable();
let lastElu = performance.eventLoopUtilization();

setInterval(() => {
  const elu = performance.eventLoopUtilization(lastElu); // 직전 구간 대비
  lastElu = performance.eventLoopUtilization();
  console.log(JSON.stringify({
    metric: 'event_loop',
    p50_ms: h.percentile(50) / 1e6,   // 값은 나노초
    p99_ms: h.percentile(99) / 1e6,
    max_ms: h.max / 1e6,
    utilization: Number(elu.utilization.toFixed(3)), // 0~1, 바쁜 시간 비율
  }));
  h.reset();
}, 10_000).unref();
```

해법:
- SSR 워커 수를 늘려 CPU 작업을 나눈다 (worker_threads, 클러스터, 인스턴스 증설).
- 루프 지연이나 사용률이 기준을 넘긴 워커는 새 요청을 받지 않게 하고 교체한다.
- 큰 동기 작업(거대한 `JSON.stringify`, 동기 압축, 정규식 폭주)을 찾아 쪼개거나 워커로 보낸다.
- 타임아웃 로그에 "상위 응답 시각"과 "콜백 실행 시각"을 같이 남기면 가짜 타임아웃을 구분할 수 있다.

## 5. 앱 캐시

- 메모리 캐시는 인스턴스마다 따로 있어 무효화가 어렵다. 짧은 TTL(수 초)로만 쓰거나, 여러 인스턴스가 공유하는 Redis를 쓴다.
- 키는 정확하게 만든다: `post:123:v2`, `topic:42:page:1`. 변경이 생기면 그 키만 지운다. 패턴 삭제(`KEYS post:*`)는 운영 Redis를 멈출 수 있다.
- 동시에 같은 키를 다시 채우는 요청이 몰리지 않게 한 요청만 원점을 부르고 나머지는 기다리게 한다 (single-flight, 락).
- 캐시에 넣는 값은 세션과 무관해야 한다. 사용자별 값은 키에 사용자 ID를 넣는다.

## 6. 목록과 관리자 데이터

전체 목록을 한 번에 보내지 않는다. 페이지네이션이나 추가 로딩을 기본으로 하고, 응답에는 화면에 필요한 필드만 담는다.
