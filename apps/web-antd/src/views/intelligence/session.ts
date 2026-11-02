import { reactive } from 'vue';

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'researcher';
  enabled: boolean;
  createdAt: number;
  lastLoginAt: null | number;
}
export const serverMode = import.meta.env.VITE_HCI_SERVER === 'true';
export const session = reactive({
  checked: false,
  setupRequired: false,
  user: null as AdminUser | null,
});
export async function adminRequest<T = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown> = {},
  timeout = 30_000,
): Promise<T> {
  const response = await fetch('/api', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, action }),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) session.user = null;
    throw new Error(result.error || '请求未完成，请稍后重试');
  }
  return result as T;
}
export async function refreshSession() {
  const result = await adminRequest<{
    setupRequired: boolean;
    user: AdminUser | null;
  }>('auth_status');
  Object.assign(session, result, { checked: true });
  if (session.user) startUserActivity();
  return result;
}
let activityStarted = false;
function startUserActivity() {
  if (activityStarted) return;
  activityStarted = true;
  let last = 0;
  const touch = () => {
    if (!session.user || Date.now() - last < 60_000) return;
    last = Date.now();
    void adminRequest('auth_touch').catch(() => {
      if (!session.user) leaveSession();
    });
  };
  window.addEventListener('pointerdown', touch, { passive: true });
  window.addEventListener('keydown', touch, { passive: true });
}
export function leaveSession() {
  localStorage.removeItem('hci-demo-state-v1');
  location.replace(`${import.meta.env.BASE_URL}auth/login`);
}
export async function logout() {
  await adminRequest('auth_logout');
  session.user = null;
  leaveSession();
}
