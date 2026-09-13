#!/usr/bin/env bash
# R1-H: 운영 모드 기본값 점검. 서비스를 새로 띄우지 않고 설정 함수와 기동 가드만 평가한다. 비밀값 원문은 출력하지 않는다.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT/services/policy-proxy"
run() { env -i PATH="$PATH" HOME="$HOME" "$@" npx --no-install tsx -e '
import { configuration } from "./src/config.ts";
const c = configuration();
const guard = process.env.NODE_ENV === "production" && ["TOI_SESSION_SECRET","TOI_CAPABILITY_SECRET","TOI_UPSTREAM_SERVICE_TOKEN"].some(k => !process.env[k]);
console.log(JSON.stringify({
  NODE_ENV: process.env.NODE_ENV ?? null,
  startupGuardWouldReject: guard,
  devAuth: c.devAuth,
  sessionSecretIsRepoDefault: c.sessionSecret === "toi-dev-session-secret-change-before-production",
  sessionSecretIsRootEnvExample: c.sessionSecret === "dev-session-secret-change-me",
  capabilitySecretIsKnownValue: ["toi-dev-capability-secret-change-before-production","dev-capability-secret-change-me"].includes(c.capabilitySecret),
}));'; }

echo "== A. NODE_ENV 미설정(dev-up.mjs 기본): dev 세션 발급 API 켜짐 + 저장소에 적힌 기본 서명 시크릿 사용"
run
echo "== B. NODE_ENV=production + services/policy-proxy/.env.example 그대로 복사 (TOI_DEV_AUTH_ENABLED=true 포함)"
run NODE_ENV=production $(grep -v '^#' .env.example | grep -v '=$' | xargs)
echo "== C. NODE_ENV=production + 루트 .env.example의 시크릿 + 서비스 토큰만 채움 (TOI_DEV_AUTH_ENABLED 미설정)"
run NODE_ENV=production TOI_SESSION_SECRET=dev-session-secret-change-me TOI_CAPABILITY_SECRET=dev-capability-secret-change-me TOI_UPSTREAM_SERVICE_TOKEN=x
echo "== D. 저장소에 적힌 기본 시크릿으로 서명한 세션을 실행 중인 7200이 받아들이는가 (/audit 200이면 기본 시크릿으로 기동 중)"
npx --no-install tsx -e '
import { signToken } from "./src/tokens.ts";
const t = signToken({ sub: "forged-admin", roles: ["platform-admin","editor","viewer"], exp: Math.floor(Date.now()/1000)+600 }, "toi-dev-session-secret-change-before-production", "session");
fetch("http://localhost:7200/audit?limit=1", { headers: { Authorization: "Bearer " + t } }).then(r => console.log("forged platform-admin session with repo default secret -> GET /audit HTTP", r.status));'
