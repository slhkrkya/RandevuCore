import { Component, computed, signal, inject, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { AudioService } from '../../services/audio.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-panel.component.html',
  styleUrls: ['./settings-panel.component.css']
})
export class SettingsPanelComponent implements OnDestroy {
  private settings = inject(SettingsService);
  private audioService = inject(AudioService);
  
  // Settings related
  isDarkMode = computed(() => this.settings.isDarkMode());
  currentTheme = computed(() => this.settings.currentTheme());
  deviceSettings = computed(() => this.settings.deviceSettings());
  speakerMonitorVolume = computed(() => this.settings.speakerMonitorVolume());
  
  // Audio related
  isAudioListening = computed(() => this.audioService.isListening());
  currentAudioVolume = computed(() => this.audioService.currentVolume());
  isAudioMuted = computed(() => this.audioService.isMuted());
  
  // Available devices
  availableCameras = signal<MediaDeviceInfo[]>([]);
  availableMicrophones = signal<MediaDeviceInfo[]>([]);
  availableSpeakers = signal<MediaDeviceInfo[]>([]);
  
  // Permission status
  hasMicrophonePermission = signal<boolean | null>(null);
  hasCameraPermission = signal<boolean | null>(null);

  constructor() {
    this.loadAvailableDevices();
    // Listen for OS-level device changes (plug/unplug)
    if (navigator && (navigator as any).mediaDevices && typeof (navigator.mediaDevices as any).addEventListener === 'function') {
      (navigator.mediaDevices as any).addEventListener('devicechange', this.handleDeviceChange);
    } else if (navigator && (navigator as any).mediaDevices) {
      // Fallback: older browsers may expose ondevicechange
      try {
        (navigator.mediaDevices as any).ondevicechange = this.handleDeviceChange as any;
      } catch {}
    }
  }

  // Stop monitoring on global pointer up (in case user releases outside the button)
  @HostListener('document:pointerup')
  onGlobalPointerUp() {
    if (this.isAudioListening()) {
      this.stopAudioMonitoring();
    }
  }

  // Stop monitoring if page/tab becomes hidden
  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (document.hidden && this.isAudioListening()) {
      this.stopAudioMonitoring();
    }
  }

  ngOnDestroy(): void {
    if (this.isAudioListening()) {
      this.stopAudioMonitoring();
    }
    if (navigator && (navigator as any).mediaDevices && typeof (navigator.mediaDevices as any).removeEventListener === 'function') {
      (navigator.mediaDevices as any).removeEventListener('devicechange', this.handleDeviceChange);
    } else if (navigator && (navigator as any).mediaDevices) {
      try {
        (navigator.mediaDevices as any).ondevicechange = null;
      } catch {}
    }
  }

  // Safely handle device changes to avoid breaking the UI when devices appear/disappear
  private handleDeviceChange = async () => {
    try {
      await this.loadAvailableDevices();
      // Re-apply output sink to selected speaker or default if none
      const current = this.deviceSettings();
      await this.audioService.setOutputDevice(current.speakerDeviceId || '');
    } catch (err) {
      console.warn('Device change handling failed:', err);
    }
  };

  // Theme methods
  setTheme(theme: 'light' | 'dark' | 'system') {
    this.settings.setTheme(theme);
  }

  // Device methods
  async loadAvailableDevices() {
    try {
      // Get all devices
      let devices = await navigator.mediaDevices.enumerateDevices();
      let cameras = devices.filter(device => device.kind === 'videoinput');
      let microphones = devices.filter(device => device.kind === 'audioinput');
      let speakers = devices.filter(device => device.kind === 'audiooutput');
      
      // Always show speakers (no permission needed)
      this.availableSpeakers.set(speakers);
      
      // Check permissions by looking at device labels
      // If labels are empty, permission is not granted
      const microphonePermission = microphones.length > 0 && microphones[0].label !== '';
      const cameraPermission = cameras.length > 0 && cameras[0].label !== '';
      
      // Set permission states
      this.hasMicrophonePermission.set(microphonePermission);
      this.hasCameraPermission.set(cameraPermission);
      
      // Show cameras if permission granted
      if (cameraPermission) {
        this.availableCameras.set(cameras);
      } else {
        this.availableCameras.set([]);
      }
      
      // Show microphones if permission granted
      if (microphonePermission) {
        this.availableMicrophones.set(microphones);
      } else {
        this.availableMicrophones.set([]);
      }
      
      // After loading devices, ensure selected devices are still valid
      this.validateSelectedDevices();
      
    } catch (error) {
      console.warn('Failed to load devices:', error);
      this.hasMicrophonePermission.set(false);
      this.hasCameraPermission.set(false);
      this.availableCameras.set([]);
      this.availableMicrophones.set([]);
      this.availableSpeakers.set([]);
    }
  }

  // Validate that selected devices are still available
  private validateSelectedDevices() {
    const deviceSettings = this.deviceSettings();
    
    // Check if selected camera is still available
    if (deviceSettings.cameraDeviceId) {
      const cameraExists = this.availableCameras().some(camera => camera.deviceId === deviceSettings.cameraDeviceId);
      if (!cameraExists) {
        this.settings.setCameraDevice(null);
      }
    }
    
    // Check if selected microphone is still available
    if (deviceSettings.microphoneDeviceId) {
      const microphoneExists = this.availableMicrophones().some(mic => mic.deviceId === deviceSettings.microphoneDeviceId);
      if (!microphoneExists) {
        this.settings.setMicrophoneDevice(null);
      }
    }
    
    // Check if selected speaker is still available
    if (deviceSettings.speakerDeviceId) {
      const speakerExists = this.availableSpeakers().some(speaker => speaker.deviceId === deviceSettings.speakerDeviceId);
      if (!speakerExists) {
        this.settings.setSpeakerDevice(null);
      }
    }
  }

  setCameraDevice(deviceId: string | null) {
    this.settings.setCameraDevice(deviceId);
  }

  setMicrophoneDevice(deviceId: string | null) {
    this.settings.setMicrophoneDevice(deviceId);
  }

  setSpeakerDevice(deviceId: string | null) {
    this.settings.setSpeakerDevice(deviceId);
    // Also update monitoring sink immediately
    this.audioService.setOutputDevice(deviceId || '');
  }

  setMicrophoneVolume(volume: number) {
    this.settings.setMicrophoneVolume(volume);
  }

  setSpeakerMonitorVolume(volume: number) {
    this.settings.setSpeakerMonitorVolume(volume);
  }

  getDeviceName(device: MediaDeviceInfo): string {
    if (device.label) {
      return device.label;
    }
    
    // Return generic names based on device kind
    switch (device.kind) {
      case 'videoinput':
        return 'Kamera';
      case 'audioinput':
        return 'Mikrofon';
      case 'audiooutput':
        return 'Hoparlör';
      default:
        return `${device.kind} ${device.deviceId.slice(0, 8)}`;
    }
  }

  async requestMicrophonePermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      this.hasMicrophonePermission.set(true);
      await this.loadAvailableDevices();
    } catch (error) {
      console.warn('Microphone permission denied');
      this.hasMicrophonePermission.set(false);
    }
  }

  async requestCameraPermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true });
      this.hasCameraPermission.set(true);
      await this.loadAvailableDevices();
    } catch (error) {
      console.warn('Camera permission denied');
      this.hasCameraPermission.set(false);
    }
  }

  // Audio control methods
  async toggleAudioMonitoring() {
    if (this.isAudioListening()) {
      this.stopAudioMonitoring();
    } else {
      await this.startAudioMonitoring();
    }
  }

  async startAudioMonitoring() {
    if (!this.isAudioListening()) {
      const deviceSettings = this.deviceSettings();
      const success = await this.audioService.initializeAudio(deviceSettings.microphoneDeviceId || undefined);
      if (success) {
        this.audioService.setVolume(deviceSettings.microphoneVolume);
        // Apply global monitoring volume
        this.audioService.setMonitoringVolume(this.speakerMonitorVolume());
        // Ensure output sink follows selected speaker
        await this.audioService.setOutputDevice(deviceSettings.speakerDeviceId || '');
      }
    }
  }

  stopAudioMonitoring() {
    if (this.isAudioListening()) {
      this.audioService.cleanup();
    }
  }

  toggleAudioMute() {
    this.audioService.toggleMute();
  }
}
