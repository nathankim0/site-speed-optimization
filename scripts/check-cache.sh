#!/usr/bin/env bash
# check-cache.sh: request a URL several times and report cache headers, HIT/MISS and TTFB.
# Needs only bash and curl. Works with the bash 3.2 that ships with macOS.
set -uo pipefail

usage() {
  cat <<'EOF'
Usage: check-cache.sh <url> [runs=3] [options]

Requests <url> several times and prints cache-related headers per request,
then warnings about common cache mistakes.

Options:
  --cookie "name=value"   send a Cookie header (check what logged-in users get)
  --ua "<user agent>"     user agent (default: a desktop Chrome string, because
                          some CDNs block curl's default agent with a 403)
  --header "K: V"         extra request header (repeatable)
  --interval <sec>        pause between requests (default 1). Edge-set cookies often
                          embed a timestamp, so a pause tells them apart from cached ones
  --json                  print JSON instead of a table
  -h, --help              show this help

Examples:
  ./check-cache.sh https://example.com/
  ./check-cache.sh https://example.com/post/1 5 --cookie "session=abc"
  ./check-cache.sh https://example.com/ 3 --json > cache.json

Exit code: 0 when done (even with warnings), 2 on bad input or network failure.
EOF
}

URL=""
RUNS=3
COOKIE=""
JSON=0
INTERVAL=1
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
EXTRA_HEADERS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --json) JSON=1 ;;
    --cookie) [ $# -ge 2 ] || { echo "error: --cookie needs a value" >&2; exit 2; }; COOKIE="$2"; shift ;;
    --interval) [ $# -ge 2 ] || { echo "error: --interval needs a value" >&2; exit 2; }; INTERVAL="$2"; shift ;;
    --ua) [ $# -ge 2 ] || { echo "error: --ua needs a value" >&2; exit 2; }; UA="$2"; shift ;;
    --header) [ $# -ge 2 ] || { echo "error: --header needs a value" >&2; exit 2; }; EXTRA_HEADERS+=("$2"); shift ;;
    -*) echo "error: unknown option $1 (see --help)" >&2; exit 2 ;;
    *)
      if [ -z "$URL" ]; then URL="$1"
      elif [[ "$1" =~ ^[0-9]+$ ]]; then RUNS="$1"
      else echo "error: unexpected argument '$1' (see --help)" >&2; exit 2
      fi ;;
  esac
  shift
done

[ -n "$URL" ] || { usage >&2; exit 2; }
case "$URL" in http://*|https://*) ;; *) echo "error: URL must start with http:// or https://" >&2; exit 2 ;; esac
[ "$RUNS" -ge 1 ] 2>/dev/null || { echo "error: runs must be a positive integer" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is not installed" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# header <file> <name>: value of the last occurrence of a response header (case-insensitive)
header() {
  awk -v n="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { IGNORECASE = 1 }
    /^HTTP\// { v = "" }                      # reset on each response (redirect chains, 103)
    {
      line = $0; sub(/\r$/, "", line)
      i = index(line, ":"); if (i == 0) next
      k = tolower(substr(line, 1, i - 1))
      if (k == n) { val = substr(line, i + 1); sub(/^[ \t]+/, "", val); v = (v == "" ? val : v ", " val) }
    }
    END { print v }' "$1"
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\r\n'; }

CURL_ARGS=(-sS -o /dev/null -A "$UA" -H "Accept: text/html,*/*" -H "Accept-Encoding: br, gzip")
[ -n "$COOKIE" ] && CURL_ARGS+=(-H "Cookie: $COOKIE")
if [ ${#EXTRA_HEADERS[@]} -gt 0 ]; then for h in "${EXTRA_HEADERS[@]}"; do CURL_ARGS+=(-H "$h"); done; fi

FIELDS="cache-control cdn-cache-control age cf-cache-status x-cache x-vercel-cache x-cache-status x-nextjs-cache vary content-encoding content-type"
i=1
while [ "$i" -le "$RUNS" ]; do
  if ! curl "${CURL_ARGS[@]}" -D "$TMP/h$i" -w '%{http_code} %{time_starttransfer}' "$URL" > "$TMP/w$i" 2> "$TMP/e$i"; then
    echo "error: request $i to $URL failed: $(cat "$TMP/e$i") (check DNS, TLS, or network access)" >&2
    exit 2
  fi
  [ "$i" -lt "$RUNS" ] && sleep "$INTERVAL"
  i=$((i + 1))
done

# Collect per-run values into plain variables r<i>_<field>
cache_state() { # normalize the cache result from any CDN header to HIT / MISS / STALE / BYPASS / DYNAMIC / -
  local f="$1" v
  for k in cf-cache-status x-vercel-cache x-cache-status x-nextjs-cache x-cache; do
    v="$(header "$f" "$k")"
    [ -n "$v" ] || continue
    v="$(printf '%s' "$v" | tr '[:lower:]' '[:upper:]')"
    case "$v" in
      *REFRESHHIT*|*REVALIDATED*) echo "REVALIDATED"; return ;;
      *HIT*|*PRERENDER*) echo "HIT"; return ;;
      *STALE*|*UPDATING*) echo "STALE"; return ;;
      *MISS*|*EXPIRED*) echo "MISS"; return ;;
      *BYPASS*) echo "BYPASS"; return ;;
      *DYNAMIC*) echo "DYNAMIC"; return ;;
      *FUNCTIONGENERATED*|*ERROR*) echo "GENERATED"; return ;;
      *) echo "$v" | cut -c1-12; return ;;
    esac
  done
  echo "-"
}

WARN=()
warn() { WARN+=("$1"); }

hits=0; set_cookie_hit_values=""; any_html=0; status_first=""
i=1
while [ "$i" -le "$RUNS" ]; do
  read -r code ttfb < "$TMP/w$i"
  state="$(cache_state "$TMP/h$i")"
  sc="$(header "$TMP/h$i" set-cookie)"
  ct="$(header "$TMP/h$i" content-type)"
  eval "r${i}_code=\$code; r${i}_ttfb=\$ttfb; r${i}_state=\$state; r${i}_sc=\$sc"
  [ -z "$status_first" ] && status_first="$code"
  case "$ct" in *text/html*) any_html=1 ;; esac
  if [ "$state" = "HIT" ] || [ "$state" = "REVALIDATED" ]; then
    hits=$((hits + 1))
    [ -n "$sc" ] && set_cookie_hit_values="$set_cookie_hit_values${sc}"$'\n'
  fi
  i=$((i + 1))
done

last="$TMP/h$RUNS"
cc="$(header "$last" cache-control | tr '[:upper:]' '[:lower:]')"
vary="$(header "$last" vary | tr '[:upper:]' '[:lower:]')"
enc="$(header "$last" content-encoding)"
xcache="$(header "$last" x-cache)"

# Warning rules
case "$status_first" in
  403|429|503)
    if printf '%s' "$xcache" | grep -qi 'FunctionGenerated\|Error' || [ "$status_first" = "429" ]; then
      warn "status $status_first looks like a bot or rate-limit block at the edge; header checks below describe the block page, not the real page. Try --ua with a real browser string."
    else
      warn "status $status_first: the response may be a block or error page, not the real page."
    fi ;;
esac
if [ "$any_html" = 1 ] && [ -n "$set_cookie_hit_values" ]; then
  total_sc="$(printf '%s' "$set_cookie_hit_values" | sed '/^$/d' | wc -l | tr -d ' ')"
  distinct="$(printf '%s' "$set_cookie_hit_values" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')"
  if [ "$total_sc" -lt 2 ]; then
    warn "an HTML cache HIT carries Set-Cookie. Run with more requests to see whether the value repeats (cached cookie, critical) or changes (added at the edge)."
  elif [ "$distinct" = 1 ]; then
    warn "CRITICAL (likely): cached HTML responses (HIT) carry the SAME Set-Cookie value, so the cookie was probably stored in the shared cache and is sent to every visitor. Confirm with a larger --interval; CloudFront does this when cookies are forwarded."
  else
    warn "HTML HIT responses carry Set-Cookie, but the value changes per request, so the edge probably adds it after the cache. Confirm the cookie holds no session or personal data."
  fi
elif [ "$any_html" = 1 ] && [ -n "$(header "$last" set-cookie)" ] && printf '%s' "$cc" | grep -q 'public\|s-maxage'; then
  warn "HTML is marked public/s-maxage but also sets a cookie. Many CDNs then refuse to cache it (Vercel always does), or worse, cache the cookie. Move the cookie to a separate no-store request."
fi
if [ "$hits" -gt 0 ] && printf '%s' "$cc" | grep -qE 'private|no-store'; then
  warn "the response says private/no-store but a shared cache served it as a HIT. The CDN overrides the origin (for example a CloudFront Minimum TTL above 0, or a Cloudflare 'ignore cache-control' rule). Personal data can leak this way."
fi
if [ "$RUNS" -ge 2 ] && [ "$hits" -eq 0 ]; then
  warn "no cache HIT in $RUNS requests. The page is not cached at the CDN/proxy (or the cache status header is hidden)."
fi
case "$vary" in *cookie*) warn "Vary includes Cookie: every distinct cookie gets its own cache entry, so shared caching almost never hits. Vercel does not cache Vary: Cookie responses at all." ;; esac
case "$vary" in *'*'*) warn "Vary: * disables shared caching." ;; esac
if [ "$any_html" = 1 ] && printf '%s' "$cc" | grep -q 'no-store' && [ -z "$COOKIE" ]; then
  warn "anonymous HTML is no-store. If this page is the same for every visitor, it can be cached (see references/caching.md). no-store also blocks bfcache in some browsers."
fi
case "$status_first" in
  3??)
    warn "status $status_first redirects to $(header "$last" location). Redirects are not followed; run again with the final URL."
    ;;
esac
if [ -z "$enc" ] && [[ "$status_first" != 3?? ]]; then
  warn "no content-encoding: the response is not compressed (gzip/br/zstd) for a client that accepts it."
fi
if [ -z "$cc" ] && [[ "$status_first" != 3?? ]]; then
  warn "no Cache-Control header: caches fall back to heuristics, so behavior differs by CDN and browser."
fi

if [ "$JSON" = 1 ]; then
  printf '{"url":"%s","runs":[' "$(json_escape "$URL")"
  i=1
  while [ "$i" -le "$RUNS" ]; do
    eval "code=\$r${i}_code; ttfb=\$r${i}_ttfb; state=\$r${i}_state; sc=\$r${i}_sc"
    [ "$i" -gt 1 ] && printf ','
    printf '{"run":%d,"status":%s,"ttfb_ms":%s,"cache":"%s","set_cookie":%s' "$i" "$code" \
      "$(awk -v t="$ttfb" 'BEGIN{printf "%.0f", t*1000}')" "$state" "$([ -n "$sc" ] && echo true || echo false)"
    for f in $FIELDS; do printf ',"%s":"%s"' "$f" "$(json_escape "$(header "$TMP/h$i" "$f")")"; done
    printf '}'
    i=$((i + 1))
  done
  printf '],"warnings":['
  n=0
  if [ ${#WARN[@]} -gt 0 ]; then for w in "${WARN[@]}"; do [ $n -gt 0 ] && printf ','; printf '"%s"' "$(json_escape "$w")"; n=$((n + 1)); done; fi
  printf ']}\n'
  exit 0
fi

echo "URL: $URL"
[ -n "$COOKIE" ] && echo "Cookie: (sent)"
printf '%-3s %-6s %-8s %-11s %-6s %-6s %-5s\n' "#" "status" "ttfb_ms" "cache" "age" "cookie" "enc"
i=1
while [ "$i" -le "$RUNS" ]; do
  eval "code=\$r${i}_code; ttfb=\$r${i}_ttfb; state=\$r${i}_state; sc=\$r${i}_sc"
  printf '%-3s %-6s %-8s %-11s %-6s %-6s %-5s\n' "$i" "$code" "$(awk -v t="$ttfb" 'BEGIN{printf "%.0f", t*1000}')" \
    "$state" "$(header "$TMP/h$i" age | cut -c1-6)" "$([ -n "$sc" ] && echo yes || echo no)" "$(header "$TMP/h$i" content-encoding | cut -c1-5)"
  i=$((i + 1))
done
echo
echo "Headers (last response):"
for f in $FIELDS; do
  v="$(header "$last" "$f")"
  [ -n "$v" ] && printf '  %-18s %s\n' "$f:" "$v"
done
printf '  %-18s %s\n' "set-cookie:" "$([ -n "$(header "$last" set-cookie)" ] && echo present || echo none)"
echo
if [ ${#WARN[@]} -eq 0 ]; then
  echo "No warnings."
else
  echo "Warnings:"
  for w in "${WARN[@]}"; do echo "  - $w"; done
fi
