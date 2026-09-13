import { setTimeout } from 'node:timers/promises';
import type { AgentContext, AgentDriver } from './engine.ts';
import { mockFiles } from './templates.ts';
export class MockDriver implements AgentDriver {
  readonly mode = 'mock' as const;
  constructor(private delayMs = 10) {}
  async run(context: AgentContext) {
    for (const delta of ['요청을 확인했습니다. ', '등록된 API를 사용하는 화면을 준비합니다. ']) {
      await setTimeout(this.delayMs, undefined, { signal: context.signal });
      context.text(delta);
    }
    const answer = await context.tool('ask_user', { question: '조회 사유 기본값을 넣을까요?', options: ['예', '아니요'] });
    context.active();
    const reason = String(answer).includes('아니') ? '' : '고객 문의 확인';
    for (const [path, content] of Object.entries(mockFiles(context.record.request.prompt, reason))) {
      await setTimeout(this.delayMs, undefined, { signal: context.signal });
      await context.tool('write_file', { path, content });
    }
    await context.tool('finish', { summary: '조회 사유를 입력하는 고객 어드민 화면을 생성했습니다.' });
  }
}
