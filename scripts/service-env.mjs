// Runtime children never inherit the caller's environment wholesale.
export const executionKeys = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'NODE_ENV'];
const storageKeys = ['MINIO_ENDPOINT', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'];
export const serviceKeys = {
  'mock-backend': ['TOI_PREVIEW_SERVICE_TOKEN', 'TOI_LIVE_SERVICE_TOKEN'],
  'policy-proxy': ['TOI_SESSION_SECRET', 'TOI_CAPABILITY_SECRET', 'TOI_PREVIEW_SERVICE_TOKEN', 'TOI_LIVE_SERVICE_TOKEN', 'TOI_IDENTITY_ISSUER', 'TOI_POLICY_CLIENT_SECRET', 'TOI_POLICY_DATA_DIR', 'TOI_AGENT_URL', 'TOI_CUSTOMERS_UPSTREAM', 'TOI_UPSTREAM_ALLOWLIST', 'TOI_SUB_DANA', 'TOI_APPROVAL_TTL_SEC', 'TOI_DOWNLOAD_KEK', 'TOI_DOWNLOAD_KEK_ID', 'TOI_DOWNLOAD_URL_SECRET', 'TOI_DOWNLOAD_BUCKET', 'TOI_AUDIT_BUCKET', 'TOI_AUDIT_RETENTION_DAYS', ...storageKeys],
  'deps-builder': ['TOI_REGISTRY_URL', 'TOI_REGISTRY_TOKEN', 'DEPS_BUILDER_PUBLIC_URL', 'MINIO_BUCKET', ...storageKeys],
  'agent-server': ['AGENT_MODE', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_TIMEOUT_MS', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_TOOL_PROTOCOL', 'DATA_DIR', 'AGENT_STUDIO_ORIGIN', 'POLICY_PROXY_URL', 'TOI_IDENTITY_ISSUER', 'TOI_AGENT_CLIENT_SECRET'],
  studio: ['VITE_OIDC_ISSUER', 'VITE_OIDC_CLIENT_ID', 'TOI_ENABLE_BENCH', 'TOI_E2E'],
};
export function selectEnv(keys, env = process.env) {
  return Object.fromEntries([...executionKeys, ...keys].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}
export function serviceEnvironment(name, env = process.env) {
  if (!Object.hasOwn(serviceKeys, name)) throw new Error('Unknown service environment');
  const selected = { ...selectEnv(serviceKeys[name], env), TOI_MANAGED_ENV: '1' };
  if (name === 'agent-server') selected.AGENT_MODE ??= 'mock';
  if (name === 'policy-proxy') {
    selected.MINIO_ROOT_USER = env.TOI_POLICY_MINIO_USER;
    selected.MINIO_ROOT_PASSWORD = env.TOI_POLICY_MINIO_PASSWORD;
  }
  return Object.fromEntries(Object.entries(selected).filter(([, value]) => value !== undefined));
}
export function commandEnvironment(kind, env = process.env) {
  const keys = kind === 'docker' ? ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'COMPOSE_PROJECT_NAME', 'TOI_KEYCLOAK_ADMIN_PASSWORD', ...storageKeys] : kind === 'registry' ? ['TOI_REGISTRY_URL', 'TOI_REGISTRY_TOKEN'] : kind === 'publish' ? ['TOI_REGISTRY_URL', 'TOI_REGISTRY_TOKEN'] : [];
  return { ...selectEnv(keys, env), TOI_MANAGED_ENV: '1' };
}
