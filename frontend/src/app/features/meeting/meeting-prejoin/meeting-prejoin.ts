import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SettingsService } from '../../../core/services/settings.service';
import { VideoEffectsService } from '../../../core/services/video-effects.service';
import { PermissionService } from '../../../core/services/permission.service';

interface MediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

@Component({
  selector: 'app-meeting-prejoin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meeting-prejoin.html',
  styleUrls: ['./meeting-prejoin.css'],
  providers: []
})
export class MeetingPrejoinComponent implements OnInit, OnDestroy {
  @ViewChild('previewVideo', { static: true }) previewVideo!: ElementRef<HTMLVideoElement>;

  meetingId = '';
  loading = false;
  isCameraOn = false;
  isMicOn = false;
  cameraError = false;
  audioLevel = 0;
  
  isDeviceReady = false;
  deviceCheckMessage = 'Cihazlar hazırlanıyor...';

  availableCameras: MediaDeviceInfo[] = [];
  availableMicrophones: MediaDeviceInfo[] = [];
  selectedCamera = '';
  selectedMicrophone = '';

  private localStream?: MediaStream; // raw camera/mic stream
  private processedStream?: MediaStream;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private dataArray?: Uint8Array;
  private animationFrame?: number;

  private settings = inject(SettingsService);
  private effects = inject(VideoEffectsService);
  public permissionService = inject(PermissionService);

  // Mirror preview from settings
  mirrorPreview = computed(() => this.settings.settings().videoBackground.mirrorPreview ?? true);

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    
    this.deviceCheckMessage = 'Cihazlarınız hazırlanıyor...';
    
    try {
      await this.effects.preload();
      
      this.deviceCheckMessage = 'Cihaz erişimi isteniyor...';
      await this.requestInitialPermission();
      
      this.deviceCheckMessage = 'Cihazlarınız taranıyor...';
      await this.loadDevices();
      
      this.deviceCheckMessage = 'Önizleme başlatılıyor...';
      await this.startPreview();
      
      this.deviceCheckMessage = 'Bağlantı hazırlanıyor...';
      await new Promise(r => setTimeout(r, 1500));
      
      this.isDeviceReady = true;
      this.deviceCheckMessage = 'Hazır!';
    } catch (error) {
      this.deviceCheckMessage = 'Cihaz erişimi gerekli. Lütfen izinleri kontrol edin.';
      this.isDeviceReady = false;
    }
    
    window.addEventListener('settingschange', this.onSettingsChange as any);

    // Listen for permission changes
    effect(() => {
      this.permissionService.permissions();
      this.onPermissionChange();
    });
  }

  private async requestInitialPermission() {
    try {
      // Request permission for both camera and mic to get device labels
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      // Immediately stop the stream to turn off camera LED
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      // Permission request failed, continue without device labels
    }
  }

  ngOnDestroy() {
    this.stopPreview();
    this.stopAudioLevelMonitoring();
    window.removeEventListener('settingschange', this.onSettingsChange as any);
  }

  private async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      this.availableCameras = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Kamera ${device.deviceId.substring(0, 8)}`,
          kind: device.kind
        }));

      this.availableMicrophones = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Mikrofon ${device.deviceId.substring(0, 8)}`,
          kind: device.kind
        }));

      // Set default devices
      if (this.availableCameras.length > 0) {
        this.selectedCamera = this.availableCameras[0].deviceId;
      }
      if (this.availableMicrophones.length > 0) {
        this.selectedMicrophone = this.availableMicrophones[0].deviceId;
      }
    } catch (error) {
      // Device loading error occurred
    }
  }

  private async startPreview() {
    try {
      this.loading = true;
      this.cameraError = false;

      // Stop existing stream first
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = undefined;
      }

      // Only request media if needed
      if (this.isCameraOn || this.isMicOn) {
        const constraints: MediaStreamConstraints = {
          video: this.isCameraOn ? {
            deviceId: this.selectedCamera ? { exact: this.selectedCamera } : undefined
          } : false,
          audio: this.isMicOn ? {
            deviceId: this.selectedMicrophone ? { exact: this.selectedMicrophone } : undefined
          } : false
        };

        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Apply effects synchronously for preview
        if (this.isCameraOn && this.localStream) {
          try {
            const vb = this.settings.settings().videoBackground;
            this.processedStream = await this.effects.apply(this.localStream, vb);
          } catch {
            this.processedStream = undefined;
          }
        } else {
          this.processedStream = undefined;
        }

        // Show video
        if (this.isCameraOn && this.previewVideo) {
          this.previewVideo.nativeElement.srcObject = this.processedStream || this.localStream || null;
          // Remove CSS transform since mirror is now handled by video effects
          this.previewVideo.nativeElement.style.transform = 'none';
          try { await this.previewVideo.nativeElement.play(); } catch {}
        } else if (this.previewVideo) {
          this.previewVideo.nativeElement.srcObject = null;
        }

        // Setup audio analysis only if mic is on
        if (this.isMicOn) {
          this.setupAudioAnalysis();
          this.startAudioLevelMonitoring();
        } else {
          this.stopAudioLevelMonitoring();
          this.audioLevel = 0;
        }
      } else {
        // Both camera and mic are off, clear video
        if (this.previewVideo) {
          this.previewVideo.nativeElement.srcObject = null;
        }
        this.stopAudioLevelMonitoring();
        this.audioLevel = 0;
      }

    } catch (error) {
      this.cameraError = true;
      
      // Clear video on error
      if (this.previewVideo) {
        this.previewVideo.nativeElement.srcObject = null;
      }
    } finally {
      this.loading = false;
    }
  }

  private onSettingsChange = () => {
    // Reapply effects to raw stream for live preview when settings change
    if (this.isCameraOn && this.localStream && this.previewVideo) {
      const vb = this.settings.settings().videoBackground;
      this.effects.apply(this.localStream, vb).then(processed => {
        this.processedStream = processed;
        this.previewVideo!.nativeElement.srcObject = processed;
        // Remove CSS transform since mirror is now handled by video effects
        this.previewVideo!.nativeElement.style.transform = 'none';
      }).catch(() => {});
    }
  };

  onMirrorToggle(event: Event) {
    const input = event.target as HTMLInputElement;
    const checked = !!input?.checked;
    this.settings.setVideoBackgroundMirrorPreview(checked);
    
    // Reapply effects to raw stream for live preview when mirror setting changes
    if (this.isCameraOn && this.localStream && this.previewVideo) {
      const vb = this.settings.settings().videoBackground;
      this.effects.apply(this.localStream, vb).then(processed => {
        this.processedStream = processed;
        this.previewVideo!.nativeElement.srcObject = processed;
        // Remove CSS transform since mirror is now handled by video effects
        this.previewVideo!.nativeElement.style.transform = 'none';
      }).catch(() => {});
    }
  }

  private setupAudioAnalysis() {
    if (!this.localStream) return;

    try {
      // Close existing audio context
      if (this.audioContext) {
        this.audioContext.close();
      }
      
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      
      source.connect(this.analyser);
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(new ArrayBuffer(bufferLength));
    } catch (error) {
      console.error('Error setting up audio analysis:', error);
    }
  }

  private startAudioLevelMonitoring() {
    // Stop existing monitoring
    this.stopAudioLevelMonitoring();
    
    const updateAudioLevel = () => {
      if (this.analyser && this.isMicOn && this.localStream) {
        try {
          // Create a new Uint8Array with proper ArrayBuffer
          const buffer = new Uint8Array(this.analyser.frequencyBinCount);
          this.analyser.getByteFrequencyData(buffer);
          
          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i];
          }
          this.audioLevel = Math.min(100, (sum / buffer.length) * 3); // Increased multiplier for better visibility
        } catch (error) {
          console.error('Error updating audio level:', error);
          this.audioLevel = 0;
        }
      } else {
        this.audioLevel = 0;
      }
      
      this.animationFrame = requestAnimationFrame(updateAudioLevel);
    };
    
    updateAudioLevel();
  }

  private stopAudioLevelMonitoring() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  private stopPreview() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      this.localStream = undefined;
    }
    
    try { this.effects.stop(); } catch {}
    
    if (this.processedStream) {
      this.processedStream.getTracks().forEach(t => { 
        try { 
          t.stop(); 
          t.enabled = false;
        } catch {} 
      });
      this.processedStream = undefined;
    }
    
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = undefined;
    }
    
    this.stopAudioLevelMonitoring();
    
    if (this.previewVideo) {
      const el = this.previewVideo.nativeElement;
      el.pause();
      el.srcObject = null;
      el.load();
    }
  }

  async toggleCamera() {
    this.isCameraOn = !this.isCameraOn;
    await this.startPreview();
  }

  async toggleMicrophone() {
    this.isMicOn = !this.isMicOn;
    await this.startPreview();
    
    if (this.isMicOn) {
      this.startAudioLevelMonitoring();
    } else {
      this.stopAudioLevelMonitoring();
      this.audioLevel = 0;
    }
  }

  async onCameraChange() {
    if (this.isCameraOn) {
      await this.startPreview();
    }
  }

  async onMicrophoneChange() {
    if (this.isMicOn) {
      await this.startPreview();
      this.startAudioLevelMonitoring();
    } else {
      this.stopAudioLevelMonitoring();
      this.audioLevel = 0;
    }
  }

  async joinMeeting() {
    if (!this.isDeviceReady) {
      return;
    }
    
    try {
      this.loading = true;
      
      localStorage.setItem('preferredCamera', this.selectedCamera);
      localStorage.setItem('preferredMicrophone', this.selectedMicrophone);
      localStorage.setItem('cameraEnabled', this.isCameraOn.toString());
      localStorage.setItem('microphoneEnabled', this.isMicOn.toString());
      
      this.deviceCheckMessage = 'Cihazlarınız kapatılıyor...';
      this.stopPreview();
      
      const hasEffects = this.processedStream !== undefined;
      const initialWaitTime = hasEffects ? 800 : 400;
      
      this.deviceCheckMessage = hasEffects ? 'Görüntü efektleri temizleniyor...' : 'Toplantıya hazırlanıyor...';
      await new Promise(resolve => setTimeout(resolve, initialWaitTime));
      
      this.deviceCheckMessage = 'Cihaz durumu kontrol ediliyor...';
      const cameraReleased = await this.waitForCameraRelease();
      
      if (cameraReleased) {
        this.deviceCheckMessage = 'Toplantıya yönlendiriliyor...';
      } else {
        this.deviceCheckMessage = 'Toplantıya katılıyor...';
      }
      
      this.router.navigate(['/meetings', this.meetingId]);
    } catch (error) {
      console.error('Error joining meeting:', error);
      this.loading = false;
    }
  }
  
  private async waitForCameraRelease(maxWaitMs = 2000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: this.selectedCamera ? { exact: this.selectedCamera } : undefined }
        });
        
        testStream.getTracks().forEach(t => t.stop());
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return false;
  }

  async requestCameraPermission() {
    try {
      this.loading = true;
      this.deviceCheckMessage = 'Kamera izni isteniyor...';
      
      const success = await this.permissionService.requestCameraPermission();
      
      if (success) {
        this.deviceCheckMessage = 'Kamera izni verildi! Cihazlar yükleniyor...';
        await this.loadDevices();
        await this.startPreview();
        this.deviceCheckMessage = 'Hazır!';
      } else {
        this.deviceCheckMessage = 'Kamera izni reddedildi. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
      }
    } catch (error) {
      console.error('Error requesting camera permission:', error);
      this.deviceCheckMessage = 'Kamera izin isteği başarısız. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
    } finally {
      this.loading = false;
    }
  }

  async requestMicrophonePermission() {
    try {
      this.loading = true;
      this.deviceCheckMessage = 'Mikrofon izni isteniyor...';
      
      const success = await this.permissionService.requestMicrophonePermission();
      
      if (success) {
        this.deviceCheckMessage = 'Mikrofon izni verildi! Cihazlar yükleniyor...';
        await this.loadDevices();
        await this.startPreview();
        this.deviceCheckMessage = 'Hazır!';
      } else {
        this.deviceCheckMessage = 'Mikrofon izni reddedildi. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
      }
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      this.deviceCheckMessage = 'Mikrofon izin isteği başarısız. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
    } finally {
      this.loading = false;
    }
  }

  async requestPermissions() {
    try {
      this.loading = true;
      this.deviceCheckMessage = 'İzinler isteniyor...';
      
      const success = await this.permissionService.requestAllPermissions();
      
      if (success) {
        this.deviceCheckMessage = 'İzinler verildi! Cihazlar yükleniyor...';
        await this.loadDevices();
        await this.startPreview();
        this.deviceCheckMessage = 'Hazır!';
      } else {
        this.deviceCheckMessage = 'İzinler reddedildi. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      this.deviceCheckMessage = 'İzin isteği başarısız. Tarayıcı ayarlarından manuel olarak etkinleştirin.';
    } finally {
      this.loading = false;
    }
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

  private async onPermissionChange() {
    console.log('Permission changed:', this.permissionService.permissions());
    
    // Reset device states when permissions are revoked
    if (!this.permissionService.hasCameraPermission()) {
      this.isCameraOn = false;
      console.log('Camera permission revoked - turning off camera');
    }
    
    if (!this.permissionService.hasMicrophonePermission()) {
      this.isMicOn = false;
      console.log('Microphone permission revoked - turning off microphone');
    }
    
    // If permissions are now available, reload devices and restart preview
    if (this.permissionService.hasCameraPermission() || this.permissionService.hasMicrophonePermission()) {
      try {
        await this.loadDevices();
        await this.startPreview();
        console.log('Devices reloaded after permission change');
      } catch (error) {
        console.error('Error reloading devices after permission change:', error);
      }
    }
  }

  goBack() {
    this.router.navigate(['/meetings']);
  }
}
