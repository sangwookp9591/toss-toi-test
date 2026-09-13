import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultComposeProject = 'toi-lite';
export function composeProject(env = process.env) {
  const name = env.COMPOSE_PROJECT_NAME || defaultComposeProject;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('Invalid COMPOSE_PROJECT_NAME: use lowercase letters, digits, hyphens or underscores');
  return name;
}
// One fixed file and explicit project for up, down and exec. COMPOSE_FILE and
// COMPOSE_PROFILES are intentionally unsupported: this stack has no profiles.
export function composeArguments(args, env = process.env) {
  return ['compose', '-p', composeProject(env), '-f', 'infra/docker-compose.yml', ...args];
}
export function volumeCredentialError(service, env = process.env) {
  const project = composeProject(env);
  const keycloak = service === 'Keycloak';
  const volume = `${project}_${keycloak ? 'keycloak' : 'minio'}-data`;
  const keys = keycloak ? 'TOI_KEYCLOAK_ADMIN_PASSWORD' : 'MINIO_ROOT_USER / MINIO_ROOT_PASSWORD';
  const summary = `${service} admin authentication failed for volume ${volume}: current .env ${keys} credentials do not match the running service. ${keycloak ? 'An existing Keycloak volume keeps its original bootstrap admin password.' : 'Check the running MinIO endpoint and its root credentials; an existing volume or server may belong to another setup.'} Restore matching credentials, or discard this project's data with COMPOSE_PROJECT_NAME=${project} node scripts/dev-down.mjs --volumes and restart; alternatively start with a different COMPOSE_PROJECT_NAME. No volumes were deleted automatically.`;
  return Object.assign(new Error(summary), { safeSummary: summary });
}
