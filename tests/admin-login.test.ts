import { createApp, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeLocationKey, routerKey } from '../apps/web-antd/node_modules/vue-router/dist/vue-router.js';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  replace: vi.fn(),
  session: { setupRequired: true, ssoEnabled: false },
  startSso: vi.fn(),
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  login: mocks.login,
  session: mocks.session,
  startSso: mocks.startSso,
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
function mountLogin() {
  app = createApp(Login);
  app.provide(routerKey, { replace: mocks.replace });
  app.provide(routeLocationKey, { query: {} });
  app.mount(root);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.setupRequired = true;
  mocks.login.mockResolvedValue({});
  root = document.createElement('div');
  document.body.append(root);
  mountLogin();
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
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it('submits complete setup once and enters the workspace', async () => {
    await validSetup();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(mocks.login).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          username: 'qa_admin',
          setupCode: 'QA-code-never-sent',
        }),
        true,
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
      expect(mocks.login).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'Abcd1234' }),
        true,
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
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it('shows server rejection beside the submit button and allows retry', async () => {
    mocks.login.mockRejectedValueOnce(new Error('原研究访问码不正确'));
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
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/overview'));
    expect(mocks.login).toHaveBeenCalledTimes(2);
  });
  it('submits a normal login once and clears the password before navigating', async () => {
    app.unmount();
    mocks.session.setupRequired = false;
    mountLogin();
    await fill('输入账号', 'qa_admin');
    await fill('输入密码', 'QA-test-password-123');
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/overview'));
    expect(mocks.login).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ username: 'qa_admin', password: 'QA-test-password-123' }),
      false,
    );
    expect(root.querySelector<HTMLInputElement>('input[placeholder="输入密码"]')!.value).toBe('');
  });
  it('ignores repeated submission while busy and clears setup secrets after success', async () => {
    let signedIn!: () => void;
    mocks.login.mockReturnValue(new Promise<void>((resolve) => { signedIn = resolve; }));
    await validSetup();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(mocks.login).toHaveBeenCalledTimes(1);
    signedIn();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/overview'));
    for (const placeholder of ['仅用于首次创建管理员', '8～128个字符，支持密码管理器', '再次输入密码']) {
      expect(root.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!.value).toBe('');
    }
  });
});
