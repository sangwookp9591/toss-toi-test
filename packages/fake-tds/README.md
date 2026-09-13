# @toi/tds 로컬 디자인시스템

React 19를 peer dependency로 사용하는 ESM + TypeScript 선언 패키지다. `Button`, `Table`, `Badge`, `TextField`와 Context 기반 `ToastProvider`/`useToast`를 제공한다. React를 패키지에 번들하지 않아 조합 빌더가 앱과 동일한 React 인스턴스를 공유한다.

```tsx
import { Button, ToastProvider, useToast } from '@toi/tds';
function Save() {
  const { toast } = useToast();
  return <Button onClick={() => toast('저장했어요')}>저장</Button>;
}
export function App() {
  return <ToastProvider><Save /></ToastProvider>;
}
```

`npm ci && npm run build`로 빌드한다. `services/deps-builder/scripts/setup-registry.mjs`가 별도 임시 publish 디렉터리에서 `1.0.0`과 `1.1.0`을 만들어 로컬 Verdaccio에 게시한다. 두 버전의 `version` export는 각 버전에 맞게 달라지며 소스의 package.json은 1.0.0으로 유지한다. `reactInstance`는 브라우저 싱글톤 검증용이다.
