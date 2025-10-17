import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface ScreenShareSettings {
  isActive: boolean;
  source: 'screen' | 'window' | 'tab';
  audio: boolean;
  resolution: string;
  frameRate: number;
}

export interface ScreenShareSource {
  id: string;
  name: string;
  type: 'screen' | 'window' | 'tab';
  thumbnail?: string;
}

@Component({
  selector: 'app-screen-share',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './screen-share.html',
  styleUrls: ['./screen-share.css']
})
export class ScreenShareComponent implements OnInit, OnDestroy {
  @Input() isActive = false;
  @Input() isHost = false;
  @Input() localStream?: MediaStream;

  @Output() screenShareStart = new EventEmitter<ScreenShareSettings>();
  @Output() screenShareStop = new EventEmitter<void>();
  @Output() settingsChange = new EventEmitter<ScreenShareSettings>();

  @ViewChild('previewVideo', { static: true }) previewVideo!: ElementRef<HTMLVideoElement>;

  // Screen share settings
  screenShareSettings: ScreenShareSettings = {
    isActive: false,
    source: 'screen',
    audio: false,
    resolution: '1920x1080',
    frameRate: 30
  };

  // Available sources
  availableSources: ScreenShareSource[] = [];
  selectedSource = '';

  // Source types
  sourceTypes = [
    { value: 'screen', label: 'Entire Screen', icon: 'desktop_windows' },
    { value: 'window', label: 'Application Window', icon: 'web' },
    { value: 'tab', label: 'Browser Tab', icon: 'tab' }
  ];

  // Resolution options
  resolutions = [
    { label: 'HD (1280x720)', value: '1280x720' },
    { label: 'Full HD (1920x1080)', value: '1920x1080' },
    { label: '4K (3840x2160)', value: '3840x2160' },
    { label: 'Auto', value: 'auto' }
  ];

  // Frame rate options
  frameRates = [15, 24, 30, 60];

  // UI state
  isPreviewVisible = false;
  isSettingsOpen = false;
  isSelectingSource = false;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.updatePreview();
  }

  ngOnDestroy() {
    this.stopPreview();
  }

  private updatePreview() {
    if (this.previewVideo && this.localStream) {
      this.previewVideo.nativeElement.srcObject = this.localStream;
      this.isPreviewVisible = this.isActive;
    }
  }

  private stopPreview() {
    if (this.previewVideo) {
      this.previewVideo.nativeElement.srcObject = null;
    }
    this.isPreviewVisible = false;
  }

  // Screen share control methods
  async startScreenShare() {
    try {
      this.isSelectingSource = true;
      
      // Get available sources
      await this.getAvailableSources();
      
      if (this.availableSources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Select the first available source
      this.selectedSource = this.availableSources[0].id;
      
      // Start screen capture
      const stream = await this.captureScreen();
      
      if (stream) {
        this.screenShareSettings.isActive = true;
        this.screenShareStart.emit(this.screenShareSettings);
        this.updatePreview();
      }
      
    } catch (error) {
      this.handleScreenShareError(error);
    } finally {
      this.isSelectingSource = false;
    }
  }

  async stopScreenShare() {
    try {
      this.screenShareSettings.isActive = false;
      this.screenShareStop.emit();
      this.stopPreview();
    } catch (error) {
    }
  }

  private async getAvailableSources() {
    try {
      // This would typically use the Screen Capture API
      // For now, we'll simulate available sources
      this.availableSources = [
        {
          id: 'screen-1',
          name: 'Entire Screen',
          type: 'screen'
        },
        {
          id: 'window-1',
          name: 'Chrome Browser',
          type: 'window'
        },
        {
          id: 'tab-1',
          name: 'Current Tab',
          type: 'tab'
        }
      ];
    } catch (error) {
      this.availableSources = [];
    }
  }

  private async captureScreen(): Promise<MediaStream | null> {
    try {
      const constraints: any = {
        video: {
          mediaSource: this.screenShareSettings.source,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: this.screenShareSettings.frameRate }
        },
        audio: this.screenShareSettings.audio
      };

      // Use getDisplayMedia for screen capture
      const stream = await (navigator.mediaDevices as any).getDisplayMedia(constraints);
      
      // Handle stream end
      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      return stream;
    } catch (error) {
      throw error;
    }
  }

  private handleScreenShareError(error: any) {
    let errorMessage = 'Failed to start screen sharing';
    
    if (error.name === 'NotAllowedError') {
      errorMessage = 'Screen sharing permission denied';
    } else if (error.name === 'NotFoundError') {
      errorMessage = 'No screen source found';
    } else if (error.name === 'NotSupportedError') {
      errorMessage = 'Screen sharing not supported';
    }
    
    // Emit error event or show notification
  }

  // Settings methods
  selectSourceType(value: string) {
    this.screenShareSettings.source = value as 'screen' | 'window' | 'tab';
    this.onSourceChange();
  }

  onSourceChange() {
    this.settingsChange.emit(this.screenShareSettings);
  }

  onAudioToggle() {
    this.screenShareSettings.audio = !this.screenShareSettings.audio;
    this.settingsChange.emit(this.screenShareSettings);
  }

  onResolutionChange() {
    this.settingsChange.emit(this.screenShareSettings);
  }

  onFrameRateChange() {
    this.settingsChange.emit(this.screenShareSettings);
  }

  // UI methods
  toggleSettings() {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  // Utility methods
  getScreenShareStatus(): string {
    return this.screenShareSettings.isActive ? 'Sharing' : 'Not Sharing';
  }

  getScreenShareStatusColor(): string {
    return this.screenShareSettings.isActive ? 'text-green-600' : 'text-gray-600';
  }

  getScreenShareStatusBg(): string {
    return this.screenShareSettings.isActive ? 'bg-green-100' : 'bg-gray-100';
  }

  getSelectedSourceLabel(): string {
    const source = this.availableSources.find(s => s.id === this.selectedSource);
    return source?.name || 'Unknown Source';
  }

  getResolutionLabel(): string {
    const resolution = this.resolutions.find(r => r.value === this.screenShareSettings.resolution);
    return resolution?.label || this.screenShareSettings.resolution;
  }

  getSourceTypeIcon(): string {
    const sourceType = this.sourceTypes.find(t => t.value === this.screenShareSettings.source);
    return sourceType?.icon || 'desktop_windows';
  }

  getSourceTypeLabel(): string {
    const sourceType = this.sourceTypes.find(t => t.value === this.screenShareSettings.source);
    return sourceType?.label || 'Screen';
  }

  // Permission methods
  async requestScreenSharePermission() {
    try {
      // Request permission for screen sharing
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: false
      });
      
      // Stop the stream immediately
      stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      
      return true;
    } catch (error) {
      return false;
    }
  }

  // Screen share presets
  applyPreset(preset: string) {
    switch (preset) {
      case 'presentation':
        this.screenShareSettings.resolution = '1920x1080';
        this.screenShareSettings.frameRate = 30;
        this.screenShareSettings.audio = false;
        break;
      case 'video':
        this.screenShareSettings.resolution = '1920x1080';
        this.screenShareSettings.frameRate = 60;
        this.screenShareSettings.audio = true;
        break;
      case 'performance':
        this.screenShareSettings.resolution = '1280x720';
        this.screenShareSettings.frameRate = 15;
        this.screenShareSettings.audio = false;
        break;
      default:
        this.screenShareSettings.resolution = '1920x1080';
        this.screenShareSettings.frameRate = 30;
        this.screenShareSettings.audio = false;
    }
    this.settingsChange.emit(this.screenShareSettings);
  }
}