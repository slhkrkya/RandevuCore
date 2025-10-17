import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface CameraSettings {
  isEnabled: boolean;
  deviceId: string;
  resolution: string;
  frameRate: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

@Component({
  selector: 'app-camera-control',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './camera-control.html',
  styleUrls: ['./camera-control.css']
})
export class CameraControlComponent implements OnInit, OnDestroy {
  @Input() localStream?: MediaStream;
  @Input() isEnabled = false;
  @Input() showAdvancedSettings = false;

  @Output() cameraToggle = new EventEmitter<boolean>();
  @Output() deviceChange = new EventEmitter<string>();
  @Output() settingsChange = new EventEmitter<CameraSettings>();

  @ViewChild('previewVideo', { static: true }) previewVideo!: ElementRef<HTMLVideoElement>;

  // Camera settings
  cameraSettings: CameraSettings = {
    isEnabled: false,
    deviceId: '',
    resolution: '1280x720',
    frameRate: 30,
    brightness: 0,
    contrast: 0,
    saturation: 0
  };

  // Available devices
  availableCameras: CameraDevice[] = [];
  selectedCamera = '';

  // Video constraints
  resolutions = [
    { label: 'HD (1280x720)', value: '1280x720' },
    { label: 'Full HD (1920x1080)', value: '1920x1080' },
    { label: '4K (3840x2160)', value: '3840x2160' },
    { label: 'VGA (640x480)', value: '640x480' }
  ];

  frameRates = [15, 24, 30, 60];

  // UI state
  isPreviewVisible = false;
  isSettingsOpen = false;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadCameraDevices();
    this.updatePreview();
  }

  ngOnDestroy() {
    this.stopPreview();
  }

  private async loadCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableCameras = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.substring(0, 8)}`,
          kind: device.kind
        }));

      if (this.availableCameras.length > 0) {
        this.selectedCamera = this.availableCameras[0].deviceId;
        this.cameraSettings.deviceId = this.selectedCamera;
      }
      
      // ✅ FIXED: Force change detection after loading camera devices
      this.cdr.markForCheck();
    } catch (error) {
      console.error('Error loading camera devices:', error);
    }
  }

  private updatePreview() {
    if (this.previewVideo && this.localStream) {
      this.previewVideo.nativeElement.srcObject = this.localStream;
      this.isPreviewVisible = this.isEnabled;
    }
  }

  private stopPreview() {
    if (this.previewVideo) {
      this.previewVideo.nativeElement.srcObject = null;
    }
    this.isPreviewVisible = false;
  }

  // Camera control methods
  onCameraToggle() {
    this.cameraSettings.isEnabled = !this.cameraSettings.isEnabled;
    this.cameraToggle.emit(this.cameraSettings.isEnabled);
    this.updatePreview();
  }

  onDeviceChange() {
    this.cameraSettings.deviceId = this.selectedCamera;
    this.deviceChange.emit(this.selectedCamera);
    this.settingsChange.emit(this.cameraSettings);
  }

  onResolutionChange() {
    this.settingsChange.emit(this.cameraSettings);
  }

  onFrameRateChange() {
    this.settingsChange.emit(this.cameraSettings);
  }

  onBrightnessChange() {
    this.settingsChange.emit(this.cameraSettings);
  }

  onContrastChange() {
    this.settingsChange.emit(this.cameraSettings);
  }

  onSaturationChange() {
    this.settingsChange.emit(this.cameraSettings);
  }

  // UI methods
  toggleSettings() {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  toggleAdvancedSettings() {
    this.showAdvancedSettings = !this.showAdvancedSettings;
  }

  // Utility methods
  getCameraStatus(): string {
    return this.cameraSettings.isEnabled ? 'On' : 'Off';
  }

  getCameraStatusColor(): string {
    return this.cameraSettings.isEnabled ? 'text-green-600' : 'text-red-600';
  }

  getCameraStatusBg(): string {
    return this.cameraSettings.isEnabled ? 'bg-green-100' : 'bg-red-100';
  }

  getSelectedCameraLabel(): string {
    const camera = this.availableCameras.find(c => c.deviceId === this.selectedCamera);
    return camera?.label || 'Unknown Camera';
  }

  getResolutionLabel(): string {
    const resolution = this.resolutions.find(r => r.value === this.cameraSettings.resolution);
    return resolution?.label || this.cameraSettings.resolution;
  }

  // Camera effects
  applyCameraEffects() {
    if (!this.previewVideo) return;

    const video = this.previewVideo.nativeElement;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Apply brightness, contrast, and saturation
    ctx.filter = `
      brightness(${100 + this.cameraSettings.brightness}%)
      contrast(${100 + this.cameraSettings.contrast}%)
      saturate(${100 + this.cameraSettings.saturation}%)
    `;

    ctx.drawImage(video, 0, 0);
    
    // Update preview with effects
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newCanvas = document.createElement('canvas');
    const newCtx = newCanvas.getContext('2d');
    
    if (newCtx) {
      newCanvas.width = canvas.width;
      newCanvas.height = canvas.height;
      newCtx.putImageData(imageData, 0, 0);
      this.previewVideo.nativeElement.srcObject = newCanvas.captureStream();
    }
  }

  resetCameraEffects() {
    this.cameraSettings.brightness = 0;
    this.cameraSettings.contrast = 0;
    this.cameraSettings.saturation = 0;
    this.settingsChange.emit(this.cameraSettings);
  }

  // Camera presets
  applyPreset(preset: string) {
    switch (preset) {
      case 'portrait':
        this.cameraSettings.brightness = 10;
        this.cameraSettings.contrast = 5;
        this.cameraSettings.saturation = -5;
        break;
      case 'landscape':
        this.cameraSettings.brightness = 0;
        this.cameraSettings.contrast = 10;
        this.cameraSettings.saturation = 10;
        break;
      case 'low-light':
        this.cameraSettings.brightness = 20;
        this.cameraSettings.contrast = 15;
        this.cameraSettings.saturation = 0;
        break;
      case 'vivid':
        this.cameraSettings.brightness = 5;
        this.cameraSettings.contrast = 10;
        this.cameraSettings.saturation = 20;
        break;
      default:
        this.resetCameraEffects();
    }
    this.settingsChange.emit(this.cameraSettings);
  }
}