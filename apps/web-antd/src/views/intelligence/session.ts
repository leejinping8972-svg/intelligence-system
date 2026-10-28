import { reactive } from 'vue';

import { ssoStartUrl } from './sso-navigation';

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'researcher';
  enabled: boolean;
  createdAt: number;
  lastLoginAt: null | number;
}
interface SessionStatus {
  identityEnabled?: boolean;
  platformLinkEnabled?: boolean;
  setupRequired: boolean;
  ssoEnabled: boolean;
  user: AdminUser | null;
}
export const serverMode = import.meta.env.VITE_HCI_SERVER === 'true';
export const session = reactive({
  checked: false,
  identityEnabled: false,
  platformLinkEnabled: false,
  setupRequired: false,
  ssoEnabled: false,
  user: null as AdminUser | null,
});
let sessionRequest: Promise<SessionStatus> | undefined;
let sessionRevision = 0;

function applySession(result: Partial<SessionStatus>) {
  Object.assign(session, result, { checked: true });
  if (session.user) startUserActivity();
}

function invalidateSessionRequest() {
  sessionRevision += 1;
  sessionRequest = undefined;
}

export async function adminRequest<T = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown> = {},
  timeout = 30_000,
): Promise<T> {
  const revision = sessionRevision;
  const response = await fetch('/api', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, action }),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && revision === sessionRevision) {
      invalidateSessionRequest();
      session.user = null;
    }
    throw new Error(result.error || '请求未完成，请稍后重试');
  }
  return result as T;
}
export function refreshSession() {
  if (sessionRequest) return sessionRequest;
  const revision = sessionRevision;
  const request = adminRequest<SessionStatus>('auth_status').then((result) => {
    // A status request started before login/logout must not replace that result.
    if (revision === sessionRevision) applySession(result);
    return result;
  });
  sessionRequest = request;
  const clear = () => {
    if (sessionRequest === request) sessionRequest = undefined;
  };
  void request.then(clear, clear);
  return request;
}

export async function login(
  input: Record<string, unknown>,
  setup = false,
) {
  const result = await adminRequest<{ user: AdminUser }>(
    setup ? 'auth_setup' : 'auth_login',
    input,
  );
  invalidateSessionRequest();
  applySession({ user: result.user, setupRequired: false });
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
  location.replace(`${import.meta.env.BASE_URL}auth/login?sso=skip`);
}
export function startSso(routePath = '/overview') {
  location.replace(ssoStartUrl(routePath, import.meta.env.BASE_URL));
}
export async function logout() {
  await adminRequest('auth_logout');
  invalidateSessionRequest();
  session.user = null;
  leaveSession();
}
