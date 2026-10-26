# Direct Login Entry

Server builds render the shared login form from a small entry module before
loading workspace preferences, stores, routes, Ant Design or business data.
The server build disables the global brand loading overlay. Demo builds keep
their existing application startup and loading overlay.

- Inputs render before `auth_status` resolves. Submit waits for status so first
  administrator setup and configured SSO are still respected.
- Branding loads independently and updates the mounted form without replacing
  its input values. The existing local branding cache remains in use.
- Existing sessions load their requested workspace page automatically. Password
  login and first administrator setup enter `/overview`, as before.
- The login form remains mounted until the full application has mounted its
  ready route. Status and application loading errors remain recoverable.
- Passwords and setup codes are cleared after authentication. The backend
  authentication endpoints, cookies and authorization are unchanged.

## Verification

Run the login/startup Vitest suites listed in `.github/workflows/testing.yml`,
the web-antd type check and a server/history build into a separate directory.
`tests/startup-performance-ui.mjs` accepts a build path and label. Set
`HCI_QA_STATUS_DELAY=3000` and `HCI_QA_DIRECT_LOGIN=true` to verify that inputs
appear before a delayed status response, with no brand overlay. Its HTTP server
uses synthetic accounts and data and never forwards requests to production.

The 2026-10-26 local Chrome run measured visible, editable inputs at 130 ms
(1440 px) and 126 ms (390 px), with a 3-second status delay. Login JavaScript
decoded size was 123,638 bytes. Authentication, workspace entry and valid-session
reload passed in both viewports, with one initial status request, no script
errors and no document overflow. These are local results, not production timings.
