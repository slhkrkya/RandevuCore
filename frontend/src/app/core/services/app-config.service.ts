import { Injectable } from '@angular/core';

export interface PublicConfig {
  apiBaseUrl: string;
  wsUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: PublicConfig = { apiBaseUrl: '' };

  async load(): Promise<void> {
    // Load public config at runtime and fallback to sensible defaults for localhost
    const isLocalhost = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
    try {
      const res = await fetch('/assets/config.json', { cache: 'no-store' });
      if (res.ok) {
        this.config = await res.json();
      }
    } catch {}

    if (isLocalhost) {
      // Force local defaults to avoid hitting production when running locally
      const apiPort = 5125;
      this.config.apiBaseUrl = `http://localhost:${apiPort}`;
      this.config.wsUrl = `http://localhost:${apiPort}/ws`;
    }
  }

  get apiBaseUrl(): string { return this.config.apiBaseUrl || 'http://localhost:5125'; }
  get wsUrl(): string | undefined { return this.config.wsUrl; }
}


