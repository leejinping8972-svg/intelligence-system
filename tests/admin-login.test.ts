import { createApp, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routerKey } from '../apps/web-antd/node_modules/vue-router/dist/vue-router.js';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  session: { setupRequired: true },
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  adminRequest: mocks.request,
  refreshSession: mocks.refresh,
  session: mocks.session,
}));
import Login from '../apps/web-antd/src/views/intelligence/admin-login.vue';

let app: ReturnType<typeof createApp>;
let root: HTMLDivElement;
async function fill(placeholder: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`,
  )!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
async function validSetup() {
  await fill('仅用于首次创建管理员', 'QA-code-never-sent');
  await fill('输入账号', 'qa_admin');
  await fill('例如：系统管理员', 'QA Admin');
  await fill('8～128个字符，支持密码管理器', 'QA-test-password-123');
  await fill('再次输入密码', 'QA-test-password-123');
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.setupRequired = true;
  mocks.request.mockResolvedValue({});
  mocks.refresh.mockResolvedValue({});
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(Login);
  app.provide(routerKey, { replace: mocks.replace });
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  root.remove();
});

describe('real Ant Design login form submission (mock transport, no real accounts)', () => {
  it('shows validation errors when the button is clicked with missing fields', async () => {
    root
      .querySelector('button[type="submit"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('请填写账号'));
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('submits complete setup once and enters the workspace', async () => {
    await validSetup();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
        'auth_setup',
        expect.objectContaining({
          username: 'qa_admin',
          setupCode: 'QA-code-never-sent',
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/overview'),
    );
  });
  it('accepts an eight-character initial password', async () => {
    await validSetup();
    await fill('8～128个字符，支持密码管理器', 'Abcd1234');
    await fill('再次输入密码', 'Abcd1234');
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        'auth_setup',
        expect.objectContaining({ password: 'Abcd1234' }),
      ),
    );
  });
  it('shows a short password warning without sending a request', async () => {
    await validSetup();
    await fill('8～128个字符，支持密码管理器', 'short');
    await fill('再次输入密码', 'short');
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain('管理员密码需要8～128个字符'),
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('shows server rejection beside the submit button and allows retry', async () => {
    mocks.request.mockRejectedValue(new Error('原研究访问码不正确'));
    await validSetup();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        '原研究访问码不正确',
      ),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(root.querySelector('.ant-btn-loading')).toBeNull(),
    );
  });
});
