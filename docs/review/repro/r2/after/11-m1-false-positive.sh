#!/usr/bin/env bash
# R2-M1 회귀: 잔여 PII 정규식(account 패턴)이 seed 등록 API의 날짜 필드를 계좌번호로 오탐해 값을 훼손하는지 실행 중 :7200에서 확인.
# 부작용: 읽기 2건과 감사 기록(r2-probe). 토큰 원문 출력 없음.
set -uo pipefail
P=http://localhost:7200; J='Content-Type: application/json'; PR="r2-probe-fp-$(date +%s)"
tok(){ node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
V=$(curl -s -X POST $P/dev/session -H "$J" --data '{"user":"r2-probe","roles":["viewer"]}' | tok)
C=$(curl -s -X POST $P/capabilities -H "$J" -H "Authorization: Bearer $V" --data "{\"projectId\":\"$PR\",\"mode\":\"read\",\"env\":\"preview\",\"ttlSec\":60}" | tok)
H=(-H "Authorization: Bearer $V" -H "X-Toi-Project: $PR" -H "X-Toi-Capability: $C" -H 'X-Toi-Reason: r2%20false%20positive%20check')
echo "== mock-backend 원본 형식: createdAt = 2026-08-0NT00:00:00.000Z (services/mock-backend/src/data.ts:17)"
echo "== GET /proxy/customers/customers/C002/orders (등록된 연산)"
curl -s "$P/proxy/customers/customers/C002/orders" "${H[@]}"; echo
echo "== 감사 기록"
curl -s "$P/audit?projectId=$PR&limit=5" -H "Authorization: Bearer $V" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(r=>JSON.stringify({path:r.path,maskedFields:r.maskedFields,policyWarnings:r.policyWarnings})).join("\n")'
