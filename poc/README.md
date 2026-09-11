# TOI preview architecture reproduction

Captured on 2026-09-11. Files are self-contained under this directory; no global installation or Git mutation is needed. Dependencies are pinned in package.json and package-lock.json. Benchmarks use the installed Google Chrome application (headless); set CHROME_PATH for a different executable and BUN_PATH for an existing Bun executable.

```sh
cd /private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/toss-admin/poc
mkdir -p .tmp evidence
export TMPDIR="$PWD/.tmp"
npm ci --cache .cache/npm --no-audit --no-fund
node prepare-browser.mjs
node bench-node.mjs
node bench-browser.mjs
node singleton.mjs
node bench-install.mjs
node hash-cases.mjs
python3 summarize.py
node verify.mjs
python3 write-report.py
```

Run these sequentially to avoid competing benchmarks. Each script creates three independent trials per case. The browser script uses fresh contexts with HTTP `Cache-Control: no-store`; OS file cache and Chrome process/WASM compilation caches are not flushed. Thus “module ready” is localhost fetch + JS/WASM initialization, not a production WAN cold load. CPU frequency and other applications are uncontrolled.

- `fixtures.mjs`: same four files, TSX admin table, 100 rows, explicit import-map externals, memory-only VFS. esbuild context creation + first rebuild and changed-input rebuild are distinct. Rolldown uses fresh builds on each edit; it is not an incremental API benchmark.
- `bench-node.mjs`: fresh Node process per sample. esbuild Node initialize is lazy, so an empty export transform probes WASM readiness before first app bundle; this warm-up is explicitly included in `module_ready_ms` and separately recorded.
- `prepare-browser.mjs`: bundles *tool adapters* with native esbuild, copies published WASM binaries, and preserves companion worker paths. This preparation is outside timings; measured app bundling is performed by the named tool. No tool WASM source is patched.
- `bench-browser.mjs`: plain vs COOP same-origin/COEP require-corp, worker response COEP, separate-origin iframe combinations. Rolldown gets explicit `cwd: '/'` (otherwise its published input-options code falls back to unavailable process.cwd()). Server listens on ephemeral loopback ports and closes after completion.
- `singleton.mjs`: independently prebuilds React, JSX runtime, React DOM entries, React Query, and packages A/B. Peers remain external and the import map gives each singleton one URL. CJS named-export facades and require-to-import peer bridges are generated; exact peer matching prevents a package subpath from externalizing itself. Negative control embeds private copies of React/Query in B.
- `bench-install.mjs`: generates a fresh lockfile per trial, compares raw SHA256s, removes node_modules and all configured package caches for locked cold install, then removes node_modules again for warm install with retained cache. Yarn Berry uses node-modules linker, enableMirror false. Scripts are disabled; public registry only. Cache/store/global folders stay here. All exact argv, exit statuses, and individual install logs are retained.
- `hash-cases.mjs`: reproduces sorted entry list + SHA256(raw yarn.lock) then SHA256 JSON prefix 16.
- `evidence/*-results.json`: full raw measurements. `evidence/measurement-tables.md`: generated medians and three raw values.

This is a focused microbenchmark, not a replica of TOI's production app. It does not measure model generation, policy-proxy latency, CDN/WAN network, package-set build latency, browser paint, Vite CSS/plugin compatibility, or production deployment. Transformer timing does not include graph resolution/linking. Neither local installs nor singleton proofs establish all-registry or all-package compatibility.

Primary webinar capture command (the supplied virtualenv is read-only; all outputs below stay here):

```sh
SSL_CERT_FILE=$(/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/venv/bin/python -m certifi) /private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/venv/bin/yt-dlp --skip-download --write-info-json --write-description --write-auto-subs --sub-langs ko --sub-format json3 --no-cache-dir -o 'evidence/webinar.%(ext)s' 'https://youtube.com/live/xDVbTlFfu30'
```

The JSON metadata distinguishes release_date 20260825 from upload_date 20260826. The automatic Korean transcript has recognition errors; uncertainty is documented in ../astra-report.md. No `opus-analysis.md` was read.
