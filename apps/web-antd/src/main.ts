import { startLoginEntry } from './login-entry';
import { initializePublicBranding } from './public-branding';
import { serverMode } from './views/intelligence/session';

void initializePublicBranding(serverMode, import.meta.env.BASE_URL);

if (serverMode) {
  startLoginEntry();
} else {
  void import('./application').then(({ initApplication }) => initApplication());
}
