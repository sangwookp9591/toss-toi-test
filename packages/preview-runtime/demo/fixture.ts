import type { PackageSetManifest } from '../../../contracts/src/package-set.ts';
export const fixture: PackageSetManifest = {
  schemaVersion: 1, tossPackageSetHash: '0'.repeat(16), artifactKey: '0'.repeat(64), lockfileSha256: '0'.repeat(64),
  entries: ['react', 'react-dom/client', 'react/jsx-runtime'],
  importMap: { imports: {
    react: 'https://esm.sh/react@19.3.0',
    'react-dom/client': 'https://esm.sh/react-dom@19.3.0/client?external=react',
    'react/jsx-runtime': 'https://esm.sh/react@19.3.0/jsx-runtime?external=react'
  } },
  files: [], buildProfile: { builder: 'esbuild', builderVersion: '0.28.2', packageManager: 'yarn-berry', packageManagerVersion: 'fixture', target: 'es2022', nodeEnv: 'production', conditions: ['browser', 'import'], configDigest: '0'.repeat(64), registryNamespace: 'PUBLIC-DEMO-FIXTURE-NOT-A-BUILDER-ARTIFACT' },
  assetBaseUrl: 'https://esm.sh/', createdAt: '2026-09-13T00:00:00.000Z'
};
export const initialSource = `import { createRoot } from 'react-dom/client';

function App() {
  return <main style={{fontFamily:'system-ui', padding:24}}>
    <h1>Preview ready</h1>
    <p>Edit this source and build a new revision.</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);`;
