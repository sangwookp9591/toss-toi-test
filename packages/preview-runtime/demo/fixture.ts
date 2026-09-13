import type { PackageSetManifest } from '../../../contracts/src/package-set.ts';
export const fixture: PackageSetManifest = {
  schemaVersion: 1, tossPackageSetHash: '0'.repeat(16), artifactKey: '0'.repeat(64), lockfileSha256: '0'.repeat(64),
  entries: ['react', 'react-dom/client', 'react/jsx-runtime'],
  importMap: { imports: {
    react: 'http://localhost:7100/__runtime_fixture__/react.js',
    'react-dom/client': 'http://localhost:7100/__runtime_fixture__/react-dom-client.js',
    'react/jsx-runtime': 'http://localhost:7100/__runtime_fixture__/react-jsx-runtime.js'
  } },
  files: [], buildProfile: { builder: 'esbuild', builderVersion: '0.28.2', packageManager: 'yarn-berry', packageManagerVersion: 'fixture', target: 'es2022', nodeEnv: 'production', conditions: ['browser', 'import'], configDigest: '0'.repeat(64), registryNamespace: 'LOCAL-DEMO-FIXTURE-NOT-A-BUILDER-ARTIFACT' },
  assetBaseUrl: 'http://localhost:7100/__runtime_fixture__/', createdAt: '2026-09-13T00:00:00.000Z'
};
export const initialSource = `import { createRoot } from 'react-dom/client';

function App() {
  return <main style={{fontFamily:'system-ui', padding:24}}>
    <h1>Preview ready</h1>
    <p>Edit this source and build a new revision.</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);`;
