#!/usr/bin/env bash
# R2-M3: 실행 중 :7100에 서로 다른 range(^19.0.0 / 19.3.0)를 동시에 보내 실제 Yarn lockfile이 같은 artifactKey로 수렴하는지 확인.
# 부작용: Verdaccio 설치 + MinIO에 react 단일 조합 artifact가 없으면 생성(새 키, 기존 데이터 변경 없음).
set -uo pipefail
D=http://localhost:7100; J='Content-Type: application/json'
for v in '^19.0.0' '19.3.0' '~19.3.0'; do
  ( curl -s -X POST $D/package-sets -H "$J" --data "{\"entries\":[\"react\"],\"dependencies\":{\"react\":\"$v\"}}" | node -pe 'const v=JSON.parse(require("fs").readFileSync(0)); JSON.stringify({range:process.argv[1],status:v.status,artifactKey:(v.artifactKey||"").slice(0,16),lockfileSha256:(v.manifest?.lockfileSha256||"").slice(0,16),error:v.error})' "$v" ) &
done; wait
echo "== 3개 요청을 다시 보내 최종 상태 확인(완료 대기 최대 30초, 영구 building 여부)"
for v in '^19.0.0' '19.3.0' '~19.3.0'; do
  K=$(curl -s -X POST $D/package-sets -H "$J" --data "{\"entries\":[\"react\"],\"dependencies\":{\"react\":\"$v\"}}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).artifactKey')
  curl -s "$D/package-sets/$K/wait?timeoutMs=30000" | node -pe 'const v=JSON.parse(require("fs").readFileSync(0)); JSON.stringify({range:process.argv[1],status:v.status,artifactKey:v.artifactKey.slice(0,16),lockfileSha256:(v.manifest?.lockfileSha256||"").slice(0,16)})' "$v"
done
