import { Injectable } from '@angular/core';

export interface PublicConfig {
  apiBaseUrl: string;
  wsUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: PublicConfig = { apiBaseUrl: '' };

  async load(): Promise<void> {
    // Load public config from /assets/config-v4.json at runtime
    try {
      const res = await fetch('/assets/config.json', { cache: 'no-store' });
      if (res.ok) {
        this.config = await res.json();
      }
    } catch {}
  }

  get apiBaseUrl(): string { return this.config.apiBaseUrl || 'http://localhost:5125'; }
  get wsUrl(): string | undefined { return this.config.wsUrl; }
}


