import { expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import * as client from '../../policy-proxy/client/toi-fetch.ts';
import { mockFiles, templateFiles } from '../src/templates.ts';
import { assertSourcePolicy } from '../src/source-policy.ts';

// Execute the actual generated component with deterministic hook/JSX adapters.
// Deferred API promises let us observe the render during an in-flight request.
type Element = { type: string; props: Record<string, any>; children: any[] };
function mount(prompt: string, reason = '고객 문의 확인') {
  const files = { ...templateFiles(), ...mockFiles(prompt, reason) };
  assertSourcePolicy(files);
  const api = { listRecords: vi.fn(), getRecord: vi.fn(), updateStatus: vi.fn() };
  let cursor = 0;
  const hooks: any[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value: unknown) => { hooks[index] = value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    }
  };
  const jsx = (type: string, props: Element['props'], ...children: any[]): Element => ({ type, props: props ?? {}, children });
  const compiled = transformSync(files['/src/App.tsx']!, { loader: 'tsx', format: 'cjs', jsxFactory: 'jsx' });
  const module = { exports: {} as { default?: () => Element } };
  const modules: Record<string, unknown> = { react, '@toi/tds': { Button: 'Button', TextField: 'TextField', Table: 'Table' }, '@toi/fetch': client, './api': api };
  new Function('require', 'module', 'exports', 'jsx', compiled.code)((name: string) => modules[name], module, module.exports, jsx);
  function render() { cursor = 0; return module.exports.default!(); }
  function elements(): Element[] {
    const found: Element[] = [];
    function visit(node: any) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.type) { found.push(node); node.children.forEach(visit); }
    }
    visit(render()); return found;
  }
  return {
    api, query: prompt.includes('상세') ? api.getRecord : api.listRecords,
    elements, text: () => JSON.stringify(render()),
    button: (label = '조회') => elements().find(node => node.type === 'Button' && node.children.includes(label))!,
    tables: () => elements().filter(node => node.type === 'Table')
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
for (const prompt of ['고객 목록', '고객 상세', '고객 상태 변경']) {
  it(`${prompt}: initial guidance → loading/duplicate prevention → result → empty → retry`, async () => {
    const app = mount(prompt);
    expect(app.text()).toContain('조회 사유를 입력하고 조회를 눌러 주세요');
    expect(app.tables()).toHaveLength(0);
    const pending = deferred(); app.query.mockReturnValueOnce(pending.promise);
    const click = app.button().props.onClick;
    const loading = click(); await click();
    expect(app.query).toHaveBeenCalledTimes(1);
    expect(app.button('조회 중…').props.disabled).toBe(true);
    expect(app.tables()).toHaveLength(0);
    const customer = { id: 'C001', name: '고객', status: 'active' };
    pending.resolve(prompt.includes('상세') ? customer : { items: [customer] });
    await loading;
    expect(app.tables()[0]!.props.rows).toEqual([customer]);
    expect(app.button().props.disabled).toBe(false);
    app.query.mockResolvedValueOnce(prompt.includes('상세') ? null : { items: [] });
    await app.button().props.onClick();
    expect(app.text()).toContain('조건에 맞는 고객이 없어요');
    expect(app.tables()).toHaveLength(0);
    app.query.mockResolvedValueOnce({ items: [customer] });
    await app.button().props.onClick();
    expect(app.tables()[0]!.props.rows).toEqual([customer]);
  });
  it(`${prompt}: short reason prevents API calls`, async () => {
    const app = mount(prompt, ''); await app.button().props.onClick();
    expect(app.query).not.toHaveBeenCalled();
    expect(app.text()).toContain('조회 사유를 5자 이상 입력하세요.');
    expect(app.tables()).toHaveLength(0);
  });
  it.each([
    ['membership revoked', new client.ToiAccessRevokedError(), '이 프로젝트에 접근할 수 없어요.'],
    ['membership code', new client.ToiFetchError(404, 'PROJECT_NOT_FOUND'), '이 프로젝트에 접근할 수 없어요.'],
    ['typed 428', new client.ToiReasonRequiredError(), '조회 사유를 5자 이상 입력하세요.'],
    ['HTTP 428', new client.ToiFetchError(428, 'REASON_REQUIRED'), '조회 사유를 5자 이상 입력하세요.'],
    ['typed 403', new client.ToiForbiddenError(), '조회 권한이 없어요.'],
    ['HTTP 403', new client.ToiFetchError(403, 'FORBIDDEN'), '조회 권한이 없어요.'],
    ['network failure', new TypeError('Failed to fetch'), '정책 서버에 연결하지 못했어요. 잠시 후 다시 시도하세요.'],
    ['HTTP 500', new client.ToiFetchError(500, 'INTERNAL_ERROR'), '고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.'],
    ['HTTP 502', new client.ToiFetchError(502, 'UPSTREAM_FAILURE'), '고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.'],
    ['HTTP 503', new client.ToiFetchError(503, 'UNAVAILABLE'), '고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.'],
    ['unknown error', new Error('private internal detail'), '고객을 조회하지 못했어요. 잠시 후 다시 시도하세요.']
  ])(`${prompt}: %s → specific error → successful retry`, async (_label, error, message) => {
    const app = mount(prompt);
    app.query.mockRejectedValueOnce(error);
    await app.button().props.onClick();
    expect(app.text()).toContain(message);
    expect(app.text()).not.toContain('조건에 맞는 고객이 없어요');
    expect(app.text()).not.toContain('private internal detail');
    expect(app.tables()).toHaveLength(0);
    expect(app.button().props.disabled).toBe(false);
    app.query.mockResolvedValueOnce({ items: [] });
    await app.button().props.onClick();
    expect(app.text()).not.toContain(message);
    expect(app.text()).toContain('조건에 맞는 고객이 없어요');
  });
  it(`${prompt}: HTTP 404 displays empty state`, async () => {
    const app = mount(prompt); app.query.mockRejectedValueOnce(new client.ToiFetchError(404, 'NOT_FOUND'));
    await app.button().props.onClick();
    expect(app.text()).toContain('조건에 맞는 고객이 없어요');
  });
}
it.each([new client.ToiForbiddenError(), new client.ToiFetchError(403, 'EXPIRED')])('status update: denied/expired write permission offers reauthorization', async error => {
  const app = mount('고객 상태 변경'); app.api.updateStatus.mockRejectedValueOnce(error);
  await app.button('고객 상태를 정지로 변경').props.onClick();
  expect(app.text()).toContain('쓰기 권한이 없거나 허용 시간이 끝났어요. 스튜디오에서 쓰기 테스트를 다시 허용하세요.');
});
it('status update: duplicate prevention and existing success text survive refresh', async () => {
  const app = mount('고객 상태 변경'); const pending = deferred();
  app.api.updateStatus.mockReturnValueOnce(pending.promise); app.query.mockResolvedValue({ items: [] });
  const click = app.button('고객 상태를 정지로 변경').props.onClick;
  const loading = click(); await click();
  expect(app.api.updateStatus).toHaveBeenCalledTimes(1);
  expect(app.button('고객 상태를 정지로 변경').props.disabled).toBe(true);
  pending.resolve({}); await loading;
  expect(app.text()).toContain('상태를 정지로 바꿨어요');
  expect(app.api.updateStatus).toHaveBeenCalledWith('C001', 'suspended', '고객 문의 확인');
});
