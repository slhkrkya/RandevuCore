import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Disable console output in production to avoid exposing internals to end users
(() => {
  try {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    if (!isLocal) {
      const noop = () => {};
      console.log = noop as any;
      console.warn = noop as any;
      console.error = noop as any;
    }
  } catch {}
})();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
