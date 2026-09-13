#!/usr/bin/env bash
# R2-C1: 실행 중 :7200 에 대해 프리뷰 origin 발급 차단의 우회를 시도한다. 토큰 원문은 출력하지 않는다.
# 부작용: 없음(쓰기 요청은 모두 거부가 기대되는 경로만 보냄, 감사 로그에 r2-probe 기록이 남음).
set -uo pipefail
P=http://localhost:7200
PV=http://localhost:5174 ST=http://localhost:5173
PROJECT="r2-probe-$(date +%s)"
tok() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);process.stdout.write(typeof v.token==="string"?v.token:"")}catch{}})'; }
# 결과 한 줄: 라벨, HTTP 코드, ACAO 헤더, 토큰 발급 여부, 에러 코드
probe() {
  local label=$1; shift
  local h b; h=$(mktemp); b=$(mktemp)
  local code; code=$(curl -s --path-as-is -o "$b" -D "$h" -w '%{http_code}' "$@")
  local acao; acao=$(grep -i '^access-control-allow-origin' "$h" | tr -d '\r' | cut -d' ' -f2)
  local issued; issued=$(node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((typeof v.token==="string")+" "+(v.error??(Array.isArray(v)?"array("+v.length+")":"")))}catch{process.stdout.write("false non-json")}' "$b")
  printf '%-62s HTTP %s  ACAO=%-22s token=%s\n' "$label" "$code" "${acao:-none}" "$issued"
  rm -f "$h" "$b"
}
J='Content-Type: application/json'
# 스튜디오가 하는 것과 동일하게(스튜디오 Origin) viewer/editor 세션 + read capability를 준비 → 프리뷰가 실제로 받는 토큰 조합
VIEW=$(curl -s -X POST $P/dev/session -H "Origin: $ST" -H "$J" --data '{"user":"r2-probe","roles":["viewer"]}' | tok)
EDIT=$(curl -s -X POST $P/dev/session -H "Origin: $ST" -H "$J" --data '{"user":"r2-probe","roles":["viewer","editor"]}' | tok)
RCAP=$(curl -s -X POST $P/capabilities -H "Origin: $ST" -H "$J" -H "Authorization: Bearer $VIEW" --data "{\"projectId\":\"$PROJECT\",\"mode\":\"read\",\"env\":\"preview\",\"ttlSec\":300}" | tok)
echo "prepared: viewer=${#VIEW}ch editor=${#EDIT}ch readCap=${#RCAP}ch (길이만 표시)"

echo "== A. 프리뷰 origin(5174)에서 발급·레지스트리·감사 (R1 원래 공격)"
probe "A1 POST /dev/session json roles=[viewer,editor,admin]" -X POST $P/dev/session -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["viewer","editor","platform-admin"]}'
probe "A2 POST /dev/session text/plain (simple request)" -X POST $P/dev/session -H "Origin: $PV" -H 'Content-Type: text/plain' --data '{"user":"x","roles":["viewer","editor"]}'
probe "A3 POST /dev/session no content-type" -X POST $P/dev/session -H "Origin: $PV" --data-binary '{"user":"x","roles":["viewer","editor"]}' -H 'Content-Type:'
probe "A4 OPTIONS /dev/session (preflight)" -X OPTIONS $P/dev/session -H "Origin: $PV" -H 'Access-Control-Request-Method: POST'
probe "A5 POST /capabilities write (viewer token)" -X POST $P/capabilities -H "Origin: $PV" -H "$J" -H "Authorization: Bearer $VIEW" --data "{\"projectId\":\"$PROJECT\",\"mode\":\"read\",\"env\":\"live\",\"ttlSec\":3600}"
probe "A6 GET /apis (viewer token)" $P/apis -H "Origin: $PV" -H "Authorization: Bearer $VIEW"
probe "A7 GET /audit?projectId (viewer token)" "$P/audit?projectId=$PROJECT" -H "Origin: $PV" -H "Authorization: Bearer $VIEW"

echo "== B. Origin 변형 (브라우저가 보낼 수 있는 값 + 서버 문자열 비교 확인)"
probe "B1 Origin: null (sandbox/data:/blob-in-sandbox)" -X POST $P/dev/session -H 'Origin: null' -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B2 Origin: HTTP://LOCALHOST:5173 (대소문자)" -X POST $P/dev/session -H 'Origin: HTTP://LOCALHOST:5173' -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B3 Origin: http://127.0.0.1:5173" -X POST $P/dev/session -H 'Origin: http://127.0.0.1:5173' -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B4 Origin: http://localhost:5173.evil.test" -X POST $P/dev/session -H 'Origin: http://localhost:5173.evil.test' -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B5 Origin: http://localhost:05173 (포트 변형)" -X POST $P/dev/session -H 'Origin: http://localhost:05173' -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B6 Origin 중복(5174 + 5173)" -X POST $P/dev/session -H "Origin: $PV" -H "Origin: $ST" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "B7 Origin 빈 문자열" -X POST $P/dev/session -H 'Origin;' -H "$J" --data '{"user":"x","roles":["editor"]}'

echo "== C. 프리뷰 origin 허용 규칙(/proxy/*)으로 발급 라우트 도달 시도 (--path-as-is)"
probe "C1 /proxy/../dev/session" -X POST "$P/proxy/../dev/session" -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "C2 /proxy/customers/../../capabilities" -X POST "$P/proxy/customers/../../capabilities" -H "Origin: $PV" -H "$J" -H "Authorization: Bearer $VIEW" --data "{\"projectId\":\"$PROJECT\"}"
probe "C3 /proxy/%2e%2e/dev/session" -X POST "$P/proxy/%2e%2e/dev/session" -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "C4 /proxy/x/..%2f..%2fdev/session" -X POST "$P/proxy/x/..%2f..%2fdev/session" -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "C5 /proxy/customers?/dev/session" -X POST "$P/proxy/customers?/dev/session" -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "C6 /proxy%2fcustomers/../dev/session" -X POST "$P/proxy%2fcustomers/../dev/session" -H "Origin: $PV" -H "$J" --data '{"user":"x","roles":["editor"]}'
probe "C7 /PROXY/../audit" "$P/PROXY/../audit?projectId=$PROJECT" -H "Origin: $PV" -H "Authorization: Bearer $VIEW"
probe "C8 //proxy/x/../../apis" "$P//proxy/x/../../apis" -H "Origin: $PV" -H "Authorization: Bearer $VIEW"

echo "== D. 서버 간 호출 허용 규칙(Origin 없음) — 브라우저 흉내 가능성 판단용"
probe "D1 no Origin, Referer: 5174, roles=[viewer,editor]" -X POST $P/dev/session -H "Referer: $PV/frame.html" -H "$J" --data '{"user":"x","roles":["viewer","editor"]}'
probe "D2 no Origin, roles=[platform-admin] without admin token" -X POST $P/dev/session -H "$J" --data '{"user":"x","roles":["platform-admin"]}'
probe "D3 Origin studio, roles=[platform-admin]" -X POST $P/dev/session -H "Origin: $ST" -H "$J" --data '{"user":"x","roles":["platform-admin"]}'
probe "D4 no Origin, viewer → capability read env=live other project" -X POST $P/capabilities -H "$J" -H "Authorization: Bearer $VIEW" --data '{"projectId":"someone-elses-project","mode":"read","env":"live","ttlSec":3600}'

echo "== E. /audit subject 필터"
probe "E1 editor(no Origin) GET /audit (projectId 없음)" "$P/audit" -H "Authorization: Bearer $EDIT"
probe "E2 editor GET /audit?projectId=<다른 사용자 프로젝트 추정값>" "$P/audit?projectId=review-probe-1&limit=1000" -H "Authorization: Bearer $EDIT"
probe "E3 editor GET /audit?projectId=a&projectId=  (중복 파라미터)" "$P/audit?projectId=a&projectId=&limit=1000" -H "Authorization: Bearer $EDIT"
# 스튜디오 사용자 id는 스스로 선언된 sub이므로, dev 발급기에서 다른 사용자 id로 세션을 만들면 그 사람의 기록이 보이는지(프리뷰에서는 A1로 차단됨)
AGENT=$(curl -s -X POST $P/dev/session -H "$J" --data '{"user":"agent-server","roles":["viewer"]}' | tok)
USERS=$(node -e 'const fs=require("fs");const lines=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l));const u=[...new Set(lines.map(r=>r.user))].filter(x=>x.startsWith("studio-"));const p=lines.find(r=>r.user===u[0]);process.stdout.write((u[0]??"")+" "+(p?.projectId??""))' services/policy-proxy/data/audit.jsonl 2>/dev/null)
VU=${USERS% *}; VP=${USERS#* }
if [ -n "$VU" ]; then
  IMP=$(curl -s -X POST $P/dev/session -H "$J" --data "{\"user\":\"$VU\",\"roles\":[\"viewer\"]}" | tok)
  probe "E4 dev 발급기로 다른 studio 사용자 sub 사칭 → 그 사용자 /audit" "$P/audit?projectId=$VP&limit=5" -H "Authorization: Bearer $IMP"
  probe "E5 같은 요청을 프리뷰 Origin으로" "$P/audit?projectId=$VP&limit=5" -H "Origin: $PV" -H "Authorization: Bearer $IMP"
fi

echo "== F. 프리뷰가 정당하게 가진 토큰으로 할 수 있는 것 (기준선)"
probe "F1 preview GET /proxy/customers/customers (read cap, reason)" "$P/proxy/customers/customers?size=1" -H "Origin: $PV" -H "Authorization: Bearer $VIEW" -H "X-Toi-Project: $PROJECT" -H "X-Toi-Capability: $RCAP" -H 'X-Toi-Reason: r2%20probe%20read'
probe "F2 preview PATCH with read cap" -X PATCH "$P/proxy/customers/customers/C200" -H "Origin: $PV" -H "$J" -H "Authorization: Bearer $VIEW" -H "X-Toi-Project: $PROJECT" -H "X-Toi-Capability: $RCAP" -H 'X-Toi-Reason: r2%20probe%20write' --data '{"status":"active"}'
