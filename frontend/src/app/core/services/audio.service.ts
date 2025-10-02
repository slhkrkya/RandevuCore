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
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private userGainValue: number = 0.8; // remember last user-set gain (0-1)
  private userMonitoringGainValue: number = 0.3; // remember last user-set monitor gain (0-1)
  
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
      
      // Connect nodes
      // Route through gain node so mic volume affects both analyser and monitoring output
      // microphone -> gain -> analyser
      this.microphone.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      
      // monitoring path: microphone -> gain -> outputGain -> MediaStreamDestination -> HTMLAudioElement (sink selectable)
      this.gainNode.connect(this.outputGainNode);
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.outputGainNode.connect(this.destinationNode);
      
      // Lazily create the audio element for monitoring
      if (!this.audioElement) {
        this.audioElement = new Audio();
        this.audioElement.autoplay = true;
        (this.audioElement as any).playsInline = true;
        this.audioElement.muted = false;
      }
      this.audioElement.srcObject = this.destinationNode.stream;
      // Try play() to ensure audio starts
      try { await this.audioElement.play(); } catch {}
      
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
    
    // Map 0-50% to 0.0-1.0 (normal), 50-100% to 1.0-1.5 (boost)
    let gainValue: number;
    if (volume <= 50) {
      gainValue = (volume / 50); // 0..1
    } else {
      const over = (volume - 50) / 50; // 0..1
      gainValue = 1 + over * 0.5; // 1..1.5
    }
    gainValue = Math.min(gainValue, 1.5); // safety cap
    this.userGainValue = gainValue;
    if (!this.isMuted()) {
      this.gainNode.gain.value = gainValue;
    }
  }

  setMonitoringVolume(volume: number): void {
    if (!this.outputGainNode) return;
    
    // Use the same mapping as microphone volume: 0-50% => 0..1.0, 50-100% => 1.0..1.5
    let gainValue: number;
    if (volume <= 50) {
      gainValue = (volume / 50); // 0..1
    } else {
      const over = (volume - 50) / 50; // 0..1
      gainValue = 1 + over * 0.5; // 1..1.5
    }
    gainValue = Math.min(gainValue, 1.5); // safety cap
    this.userMonitoringGainValue = gainValue;
    if (!this.isMuted()) {
      this.outputGainNode.gain.value = gainValue;
    }
  }

  mute(): void {
    if (!this.gainNode) return;
    this.gainNode.gain.value = 0;
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = 0;
    }
    this.isMuted.set(true);
  }

  unmute(): void {
    if (!this.gainNode) return;
    // Restore last user-set gain
    this.gainNode.gain.value = this.userGainValue;
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = this.userMonitoringGainValue;
    }
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

  // Change output/speaker device using setSinkId if supported
  async setOutputDevice(deviceId: string | null): Promise<boolean> {
    try {
      if (!this.audioElement) {
        // If monitoring not yet started, prepare element so sink can be set early
        this.audioElement = new Audio();
        this.audioElement.autoplay = true;
        (this.audioElement as any).playsInline = true;
        this.audioElement.muted = false;
      }
      const sinkId = deviceId ?? '';
      const anyAudio = this.audioElement as any;
      if (typeof anyAudio.setSinkId === 'function') {
        await anyAudio.setSinkId(sinkId);
        return true;
      } else {
        console.warn('setSinkId not supported in this browser');
        return false;
      }
    } catch (e) {
      console.warn('Failed to set output device:', e);
      return false;
    }
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
    this.destinationNode = null;
    if (this.audioElement) {
      try { this.audioElement.pause(); } catch {}
      this.audioElement.srcObject = null;
    }
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
