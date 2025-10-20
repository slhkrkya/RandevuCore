import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MeetingAudioService {
  private localAudioStreamSubject = new BehaviorSubject<MediaStream | null>(null);
  private remoteAudioStreamsSubject = new BehaviorSubject<Map<string, MediaStream>>(new Map());
  private combinedRemoteStreamSubject = new BehaviorSubject<MediaStream | null>(null);
  private audioContext?: AudioContext;
  private destination?: MediaStreamAudioDestinationNode;
  private sources = new Map<string, MediaStreamAudioSourceNode>();

  localAudioStream$ = this.localAudioStreamSubject.asObservable();
  remoteAudioStreams$ = this.remoteAudioStreamsSubject.asObservable();
  combinedRemoteStream$ = this.combinedRemoteStreamSubject.asObservable();

  setLocalStream(stream: MediaStream | null): void {
    // We don't need to expose local playback in navbar; keep for potential analysis only
    this.localAudioStreamSubject.next(null);
  }

  setRemoteStream(userId: string, stream: MediaStream | null): void {
    const current = new Map(this.remoteAudioStreamsSubject.value);
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioOnly = new MediaStream();
        audioTracks.forEach(t => audioOnly.addTrack(t));
        current.set(userId, audioOnly);
        this.addToMix(userId, audioOnly);
      } else {
        current.delete(userId);
        this.removeFromMix(userId);
      }
    } else {
      current.delete(userId);
      this.removeFromMix(userId);
    }
    this.remoteAudioStreamsSubject.next(current);
    this.updateCombinedStream();
  }

  clearAll(): void {
    this.localAudioStreamSubject.next(null);
    this.remoteAudioStreamsSubject.next(new Map());
    this.sources.forEach(src => { try { src.disconnect(); } catch {} });
    this.sources.clear();
    try { this.destination?.disconnect(); } catch {}
    try { this.audioContext?.close(); } catch {}
    this.destination = undefined;
    this.audioContext = undefined;
    this.combinedRemoteStreamSubject.next(null);
  }

  private ensureAudioGraph() {
    if (!this.audioContext) {
      try { this.audioContext = new (window as any).AudioContext(); } catch {}
    }
    if (this.audioContext && !this.destination) {
      this.destination = this.audioContext.createMediaStreamDestination();
      this.combinedRemoteStreamSubject.next(this.destination.stream);
    }
  }

  private addToMix(userId: string, stream: MediaStream) {
    this.ensureAudioGraph();
    if (!this.audioContext || !this.destination) return;
    // Recreate source to avoid duplicates
    this.removeFromMix(userId);
    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.destination);
      this.sources.set(userId, source);
    } catch {}
  }

  private removeFromMix(userId: string) {
    const existing = this.sources.get(userId);
    if (existing) {
      try { existing.disconnect(); } catch {}
      this.sources.delete(userId);
    }
  }

  private updateCombinedStream() {
    // Destination stream already reflects current connections
    if (this.destination) {
      this.combinedRemoteStreamSubject.next(this.destination.stream);
    }
  }
}


