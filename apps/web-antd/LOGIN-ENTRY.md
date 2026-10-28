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

## Workspace Entry After Authentication

The 2026-10-28 change shortens the path from a successful login to the workspace:

- Native `Hci*` pages skip the framework form adapters. Other framework routes
  still initialize both adapters before navigation, share concurrent setup and
  permit retries after initialization failures. Non-server builds retain their
  original eager adapter setup.
- Overview charts load asynchronously outside the route's suspense boundary.
  Their loading area keeps its height; a failed download shows a local error
  after one retry. The navigation and overview counts do not wait for charts.
  Other pages that require charts still load their own chart dependencies.
- Files for the selected language load concurrently. Core and application
  messages also load together; the language is published only after both finish.
  Message names and merge order are preserved, and failures still reject setup.
- Locale, stores, tooltip and motion dependencies initialize concurrently.
  Routing and mounting still wait for these dependencies. Preferences finish
  before the bootstrap module evaluates route defaults, as before.

Functional checks: 37 login/session/startup/locale tests, complete web type check,
independent server/history build, targeted startup/locale/test ESLint and diff
checks passed. Local Edge checks covered desktop and mobile login, existing
session reload, direct research/settings routes, editable native forms, delayed
and failed chart downloads, and chart recovery with nonblank canvas pixels.
No page errors or horizontal overflow were observed. Fixtures use synthetic
accounts and workspace data, and reject non-local network requests.

The controlled comparison used gzip HTTP/1.1, 150 ms latency, 1.25 MB/s download,
2x CPU slowdown and an overview response delayed by 5 seconds. It measured login
click to the overview heading, before completion of the page transition:

| Viewport | Previous build | Updated build |
| --- | ---: | ---: |
| 1440 px | 8,299 ms | 6,248 ms |
| 390 px | 7,674 ms | 6,298 ms |
| JavaScript decoded before heading | 3,110,542 bytes | 2,124,495 bytes |

The baseline build corresponds to `91855d9539d2fd20856322d428600c13917de806`.
Raw measurements and screenshots are retained in the feature tree's ignored
`.artifacts/entry-performance/`. The local build aliases `@vben/locales` to this
tree's source because linked dependencies otherwise resolve to the integration
tree. These results isolate startup changes; HTTP/1.1 emphasizes small-file
latency, and they do not establish production account or whole-page load times.
No authentication, server queries, provider calls, schema or business data change.
