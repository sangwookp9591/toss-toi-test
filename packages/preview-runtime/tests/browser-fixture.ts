import { test as base, expect, type Page } from '@playwright/test';
// Preserve the contract's browser-visible origins while keeping the isolated demo
// servers off the running application's ports. Responses retain real CSP headers.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^http:\/\/(localhost:5173|p-[a-f0-9-]+\.preview\.localhost:5174|localhost:7100)\//, async route => {
      const original = new URL(route.request().url());
      const target = new URL(original); target.hostname = '127.0.0.1'; target.port = original.port === '5174' ? '5274' : '5273';
      const response = await route.fetch({ url: target.href, headers: {...route.request().headers(), host: original.host} });
      await route.fulfill({ response });
    });
    await use(context);
  },
});
export { expect, type Page };
