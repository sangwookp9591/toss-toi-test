// Subprocess Error objects may contain credentials in command lines or npm config.
// Only allow known diagnostic shapes into summaries; redact command output separately.
export function redact(message, env = process.env) {
 let safe = String(message);
 for (const [key, value] of Object.entries(env)) {
  if (/secret|token|password|api_?key|credential/i.test(key) && value) safe = safe.split(value).join('[REDACTED]');
 }
 return safe.replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
  .replace(/((?:_authToken|password|secret|api_?key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
export function summarizeFailure(output, fallback = 'command failed; inspect the log') {
 const text = String(output);
 const nested = text.match(/fake-tds (?:build|install) failed: (tsc not found|npm exited \d+|npm error [A-Z][A-Z0-9_]+|command failed; inspect the log)/);
 if (nested) return nested[0];
 if (/tsc[^\n]*(?:not found|command not found)/i.test(text)) return 'tsc not found';
 if (/EADDRINUSE|port is already allocated|address already in use/i.test(text)) return 'port already in use';
 if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(text)) return 'Docker daemon is unavailable';
 if (/ENOENT|command not found/i.test(text)) return 'required executable or file not found';
 const code = text.match(/npm (?:ERR!|error) code ([A-Z][A-Z0-9_]+)/);
 if (code) return `npm error ${code[1]}`;
 const status = text.match(/HTTP ([45]\d\d)/);
 if (status) return `HTTP ${status[1]}`;
 if (/fetch failed|ECONNREFUSED/.test(text)) return 'connection failed';
 return fallback;
}
