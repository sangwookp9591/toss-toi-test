import json, pathlib, subprocess, time
root = pathlib.Path(__file__).resolve().parents[3]
qa = root / 'docs/qa/qa2'
paths = subprocess.check_output(['git', 'ls-files', 'e2e/artifacts'], cwd=root, text=True).splitlines()
original = {p: (root / p).read_bytes() for p in paths}
started = time.monotonic()
try:
    with (qa / 'logs/e2e-repeat.log').open('w') as log:
        result = subprocess.run('npm --prefix e2e ci && npm --prefix e2e run test:repeat', shell=True, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    for name in ['results.json', 'studio.png', 'question-1600.png', 'question-400.png']:
        source = root / 'e2e/artifacts' / name
        if source.exists():
            destination = qa / ('logs' if name.endswith('.json') else 'shots') / ('e2e-' + name)
            destination.write_bytes(source.read_bytes())
    (qa / 'logs/e2e-command.json').write_text(json.dumps({'exitCode':result.returncode,'elapsedSeconds':time.monotonic()-started}, indent=2))
finally:
    for p, data in original.items():
        (root / p).write_bytes(data)
