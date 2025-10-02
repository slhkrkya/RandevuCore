import { Injectable, signal, computed, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioService } from './audio.service';

export interface DeviceSettings {
  cameraDeviceId: string | null;
  microphoneDeviceId: string | null;
  speakerDeviceId: string | null;
  microphoneVolume: number; // 0-100
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  devices: DeviceSettings;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly SETTINGS_KEY = 'randevucore_settings';
  private audioService = inject(AudioService);
  
  // Signals for reactive state management
  private _settings = signal<AppSettings>(this.getDefaultSettings());
  public settings = this._settings.asReadonly();
  
  // Computed signals for easy access
  public isDarkMode = computed(() => {
    const theme = this._settings().theme;
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return theme === 'dark';
  });
  
  public currentTheme = computed(() => this._settings().theme);
  public deviceSettings = computed(() => this._settings().devices);

  constructor() {
    this.loadSettings();
    this.initializeTheme();
    this.setupSystemThemeListener();
  }

  private getDefaultSettings(): AppSettings {
    return {
      theme: 'system',
      devices: {
        cameraDeviceId: null,
        microphoneDeviceId: null,
        speakerDeviceId: null,
        microphoneVolume: 80
      }
    };
  }

  loadSettings(): void {
    try {
      const saved = localStorage.getItem(this.SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this._settings.set({ ...this.getDefaultSettings(), ...parsed });
      }
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(this._settings()));
    } catch (error) {
      console.warn('Failed to save settings:', error);
    }
  }

  private initializeTheme(): void {
    const isDark = this.isDarkMode();
    this.applyTheme(isDark);
  }

  private setupSystemThemeListener(): void {
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this._settings().theme === 'system') {
          this.initializeTheme();
        }
      });
    }
  }

  private applyTheme(isDark: boolean): void {
    const html = document.documentElement;
    html.classList.remove('dark'); // Her seferinde temizle
    
    if (isDark) {
      html.classList.add('dark');
    }
    
    // Force CSS refresh - browser cache problemi için
    setTimeout(() => {
      const themeBefore = html.className;
      html.className = '';
      html.offsetHeight; // Force repaint
      html.className = themeBefore;
    }, 0);
  }

  // Public methods
  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this._settings.update(current => ({ ...current, theme }));
    this.saveSettings();
    this.initializeTheme();
    
    // Browser-specific fix for Edge/Chrome theme switching
    setTimeout(() => {
      this.forceThemeUpdate();
    }, 100);
  }
  
  private forceThemeUpdate(): void {
    const isDark = this.isDarkMode();
    const html = document.documentElement;
    
    // Force attribute update for better browser compatibility
    html.setAttribute('data-theme', isDark ? 'dark' : 'light');
    
    // Additional DOM manipulation for stubborn browsers
    const event = new Event('themechange');
    window.dispatchEvent(event);
    
    console.log(`Theme switched to: ${this._settings().theme} (dark: ${isDark})`);
  }

  setCameraDevice(deviceId: string | null): void {
    this._settings.update(current => ({
      ...current,
      devices: { ...current.devices, cameraDeviceId: deviceId }
    }));
    this.saveSettings();
  }

  setMicrophoneDevice(deviceId: string | null): void {
    this._settings.update(current => ({
      ...current,
      devices: { ...current.devices, microphoneDeviceId: deviceId }
    }));
    this.saveSettings();
    
    // Switch audio device if audio is initialized
    if (this.audioService.isListening()) {
      if (deviceId) {
        this.audioService.switchDevice(deviceId);
      }
    }
  }

  setMicrophoneVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    this._settings.update(current => ({
      ...current,
      devices: { ...current.devices, microphoneVolume: clampedVolume }
    }));
    this.saveSettings();
    
    // Apply volume to audio service
    this.audioService.setVolume(clampedVolume);
  }

  setSpeakerDevice(deviceId: string | null): void {
    this._settings.update(current => ({
      ...current,
      devices: { ...current.devices, speakerDeviceId: deviceId }
    }));
    this.saveSettings();
  }

  resetToDefaults(): void {
    this._settings.set(this.getDefaultSettings());
    this.saveSettings();
    this.initializeTheme();
  }
}
