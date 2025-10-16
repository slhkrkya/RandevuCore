import { Injectable, signal, computed } from '@angular/core';

export interface PermissionState {
  camera: 'granted' | 'denied' | 'prompt' | 'unknown';
  microphone: 'granted' | 'denied' | 'prompt' | 'unknown';
}

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private _permissions = signal<PermissionState>({
    camera: 'unknown',
    microphone: 'unknown'
  });

  public permissions = this._permissions.asReadonly();

  // Computed signals for easy access
  public hasCameraPermission = computed(() => 
    this._permissions().camera === 'granted'
  );

  public hasMicrophonePermission = computed(() => 
    this._permissions().microphone === 'granted'
  );

  public hasAnyPermission = computed(() => 
    this.hasCameraPermission() || this.hasMicrophonePermission()
  );

  public cameraPermissionDenied = computed(() => 
    this._permissions().camera === 'denied'
  );

  public microphonePermissionDenied = computed(() => 
    this._permissions().microphone === 'denied'
  );

  constructor() {
    this.checkPermissions();
  }

  async checkPermissions(): Promise<void> {
    try {
      // Check camera permission
      const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      this._permissions.update(current => ({
        ...current,
        camera: cameraPermission.state as 'granted' | 'denied' | 'prompt'
      }));

      // Check microphone permission
      const microphonePermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      this._permissions.update(current => ({
        ...current,
        microphone: microphonePermission.state as 'granted' | 'denied' | 'prompt'
      }));

      // Listen for permission changes
      cameraPermission.addEventListener('change', () => {
        this._permissions.update(current => ({
          ...current,
          camera: cameraPermission.state as 'granted' | 'denied' | 'prompt'
        }));
      });

      microphonePermission.addEventListener('change', () => {
        this._permissions.update(current => ({
          ...current,
          microphone: microphonePermission.state as 'granted' | 'denied' | 'prompt'
        }));
      });

    } catch (error) {
      await this.checkPermissionsFallback();
    }
  }

  private async checkPermissionsFallback(): Promise<void> {
    try {
      // Test camera permission
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraStream.getTracks().forEach(track => track.stop());
        this._permissions.update(current => ({ ...current, camera: 'granted' }));
      } catch (error) {
        this._permissions.update(current => ({ ...current, camera: 'denied' }));
      }

      // Test microphone permission
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach(track => track.stop());
        this._permissions.update(current => ({ ...current, microphone: 'granted' }));
      } catch (error) {
        this._permissions.update(current => ({ ...current, microphone: 'denied' }));
      }
    } catch (error) {
      // Permission check failed
    }
  }

  async requestCameraPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      this._permissions.update(current => ({ ...current, camera: 'granted' }));
      return true;
    } catch (error) {
      this._permissions.update(current => ({ ...current, camera: 'denied' }));
      return false;
    }
  }

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this._permissions.update(current => ({ ...current, microphone: 'granted' }));
      return true;
    } catch (error) {
      this._permissions.update(current => ({ ...current, microphone: 'denied' }));
      return false;
    }
  }

  async requestAllPermissions(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop());
      this._permissions.update(current => ({
        ...current,
        camera: 'granted',
        microphone: 'granted'
      }));
      return true;
    } catch (error) {
      // Try to determine which permission failed
      const hasCamera = await this.requestCameraPermission();
      const hasMic = await this.requestMicrophonePermission();
      return hasCamera || hasMic;
    }
  }

  getPermissionMessage(): string {
    const { camera, microphone } = this._permissions();
    
    if (camera === 'denied' && microphone === 'denied') {
      return 'Kamera ve mikrofon izinleri gerekli. Tarayıcı ayarlarından izinleri etkinleştirin.';
    } else if (camera === 'denied') {
      return 'Kamera izni gerekli. Tarayıcı ayarlarından kamera iznini etkinleştirin.';
    } else if (microphone === 'denied') {
      return 'Mikrofon izni gerekli. Tarayıcı ayarlarından mikrofon iznini etkinleştirin.';
    } else if (camera === 'prompt' || microphone === 'prompt') {
      return 'Cihaz izinleri isteniyor. Lütfen izinleri kabul edin.';
    }
    
    return '';
  }

  getPermissionStatusText(): string {
    const { camera, microphone } = this._permissions();
    
    if (camera === 'granted' && microphone === 'granted') {
      return 'Tüm izinler verildi';
    } else if (camera === 'granted') {
      return 'Kamera izni verildi';
    } else if (microphone === 'granted') {
      return 'Mikrofon izni verildi';
    } else if (camera === 'denied' && microphone === 'denied') {
      return 'İzinler reddedildi';
    } else if (camera === 'denied') {
      return 'Kamera izni reddedildi';
    } else if (microphone === 'denied') {
      return 'Mikrofon izni reddedildi';
    } else {
      return 'İzinler kontrol ediliyor';
    }
  }
}
