import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

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
  styleUrls: ['./meeting-prejoin.css']
})
export class MeetingPrejoinComponent implements OnInit, OnDestroy {
  @ViewChild('previewVideo', { static: true }) previewVideo!: ElementRef<HTMLVideoElement>;

  meetingId = '';
  loading = false;
  isCameraOn = false;
  isMicOn = false;
  cameraError = false;
  audioLevel = 0;

  availableCameras: MediaDeviceInfo[] = [];
  availableMicrophones: MediaDeviceInfo[] = [];
  selectedCamera = '';
  selectedMicrophone = '';

  private localStream?: MediaStream;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private dataArray?: Uint8Array;
  private animationFrame?: number;

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    
    try {
      // First request permission to get device labels
      await this.requestInitialPermission();
      await this.loadDevices();
      await this.startPreview();
    } catch (error) {
      console.error('Error initializing prejoin:', error);
    }
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
      console.error('Permission request failed:', error);
      // Don't throw error, just continue without device labels
    }
  }

  ngOnDestroy() {
    this.stopPreview();
    this.stopAudioLevelMonitoring();
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
      console.error('Error loading devices:', error);
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
        
        // Only show video if camera is on
        if (this.isCameraOn && this.previewVideo && this.localStream) {
          this.previewVideo.nativeElement.srcObject = this.localStream;
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
      console.error('Error starting preview:', error);
      this.cameraError = true;
      
      // Clear video on error
      if (this.previewVideo) {
        this.previewVideo.nativeElement.srcObject = null;
      }
    } finally {
      this.loading = false;
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
      
      console.log('Audio analysis setup complete');
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
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = undefined;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = undefined;
    }
    
    this.stopAudioLevelMonitoring();
    
    // Clear video element
    if (this.previewVideo) {
      this.previewVideo.nativeElement.srcObject = null;
    }
  }

  async toggleCamera() {
    this.isCameraOn = !this.isCameraOn;
    await this.startPreview();
  }

  async toggleMicrophone() {
    this.isMicOn = !this.isMicOn;
    await this.startPreview();
    
    // Start/stop audio monitoring based on mic state
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
    try {
      this.loading = true;
      
      // Store device preferences
      localStorage.setItem('preferredCamera', this.selectedCamera);
      localStorage.setItem('preferredMicrophone', this.selectedMicrophone);
      localStorage.setItem('cameraEnabled', this.isCameraOn.toString());
      localStorage.setItem('microphoneEnabled', this.isMicOn.toString());
      
      // Navigate to meeting room
      this.router.navigate(['/meetings', this.meetingId]);
    } catch (error) {
      console.error('Error joining meeting:', error);
    } finally {
      this.loading = false;
    }
  }

  goBack() {
    this.router.navigate(['/meetings']);
  }
}
