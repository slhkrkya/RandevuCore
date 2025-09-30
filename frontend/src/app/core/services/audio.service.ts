import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private gainNode: GainNode | null = null;
  private outputGainNode: GainNode | null = null;
  
  // Signals for reactive state
  public isListening = signal(false);
  public currentVolume = signal(0);
  public isMuted = signal(false);

  constructor() {}

  async initializeAudio(deviceId?: string): Promise<boolean> {
    try {
      // Request microphone access
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create analyser for volume monitoring
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      
      // Create output gain node for monitoring (speaker output)
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = 0.3; // Low volume for monitoring
      
      // Create microphone source
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      // Connect nodes: microphone -> gain -> analyser
      this.microphone.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      
      // Connect for monitoring: microphone -> outputGain -> destination (speakers)
      this.microphone.connect(this.outputGainNode);
      this.outputGainNode.connect(this.audioContext.destination);
      
      this.isListening.set(true);
      this.startVolumeMonitoring();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      this.cleanup();
      return false;
    }
  }

  private startVolumeMonitoring(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const monitor = () => {
      if (!this.analyser || !this.isListening()) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      
      // Convert to percentage (0-100)
      const volume = Math.round((average / 255) * 100);
      this.currentVolume.set(volume);
      
      requestAnimationFrame(monitor);
    };
    
    monitor();
  }

  setVolume(volume: number): void {
    if (!this.gainNode) return;
    
    // Convert percentage to gain value (0-1)
    const gainValue = volume / 100;
    this.gainNode.gain.value = gainValue;
  }

  setMonitoringVolume(volume: number): void {
    if (!this.outputGainNode) return;
    
    // Convert percentage to gain value (0-1), max 0.5 for safety
    const gainValue = Math.min(volume / 100, 0.5);
    this.outputGainNode.gain.value = gainValue;
  }

  mute(): void {
    if (!this.gainNode) return;
    this.gainNode.gain.value = 0;
    this.isMuted.set(true);
  }

  unmute(): void {
    if (!this.gainNode) return;
    // Restore previous volume
    const currentVolume = this.currentVolume();
    this.gainNode.gain.value = currentVolume / 100;
    this.isMuted.set(false);
  }

  toggleMute(): void {
    if (this.isMuted()) {
      this.unmute();
    } else {
      this.mute();
    }
  }

  async switchDevice(deviceId: string): Promise<boolean> {
    this.cleanup();
    return await this.initializeAudio(deviceId);
  }

  cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.microphone = null;
    this.gainNode = null;
    this.outputGainNode = null;
    this.isListening.set(false);
    this.currentVolume.set(0);
    this.isMuted.set(false);
  }

  // Get current audio stream for other components
  getCurrentStream(): MediaStream | null {
    return this.stream;
  }

  // Check if audio is supported
  isAudioSupported(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
}
