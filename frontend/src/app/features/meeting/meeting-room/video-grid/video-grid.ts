import { Component, Input, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Participant, MeetingState } from '../meeting-room';

@Component({
  selector: 'app-video-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-grid.html',
  styleUrls: ['./video-grid.css']
})
export class VideoGridComponent {
  @Input() participants: Participant[] = [];
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream;
  @Input() remoteStreams: Map<string, MediaStream> = new Map();
  @Input() meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };

  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit() {
    this.updateLocalVideo();
  }

  ngOnChanges() {
    this.updateLocalVideo();
  }

  private updateLocalVideo() {
    if (this.localVideo && this.localStream) {
      this.localVideo.nativeElement.srcObject = this.localStream;
    }
  }

  getVideoGridClass(): string {
    const totalParticipants = this.participants.length;
    
    if (totalParticipants <= 1) return 'grid-cols-1';
    if (totalParticipants <= 2) return 'grid-cols-2';
    if (totalParticipants <= 4) return 'grid-cols-2';
    if (totalParticipants <= 6) return 'grid-cols-3';
    if (totalParticipants <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  }

  getParticipantVideo(participant: Participant): MediaStream | null {
    if (participant.userId === this.currentUserId) {
      return this.localStream || null;
    }
    
    return this.remoteStreams.get(participant.userId) || null;
  }

  toggleParticipantMute(participant: Participant) {
    // This would be handled by the parent component
  }

  toggleParticipantVideo(participant: Participant) {
    // This would be handled by the parent component
  }

  isParticipantVideoVisible(participant: Participant): boolean {
    if (participant.userId === this.currentUserId) {
      return this.meetingState.isVideoOn;
    }
    
    // For remote participants, check if they have video on AND we have their stream
    const hasRemoteStream = this.remoteStreams.has(participant.userId);
    const remoteStream = this.remoteStreams.get(participant.userId);
    const hasVideoTrack = !!(hasRemoteStream && remoteStream && remoteStream.getVideoTracks().length > 0);
    
    return participant.isVideoOn && hasVideoTrack;
  }

  getParticipantDisplayName(participant: Participant): string {
    if (participant.userId === this.currentUserId) {
      return 'You';
    }
    return participant.name;
  }

  getParticipantStatus(participant: Participant): string {
    const statuses = [];
    
    if (participant.isMuted) {
      statuses.push('Muted');
    }
    
    if (!participant.isVideoOn) {
      statuses.push('Camera Off');
    }
    
    if (participant.isScreenSharing) {
      statuses.push('Sharing Screen');
    }
    
    if (participant.isHost) {
      statuses.push('Host');
    }
    
    return statuses.join(' • ');
  }

  getParticipantInitials(participant: Participant): string {
    const name = participant.name || 'User';
    const words = name.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getParticipantBackgroundColor(participant: Participant): string {
    // Generate consistent color based on user ID
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500',
      'bg-indigo-500', 'bg-yellow-500', 'bg-red-500', 'bg-teal-500'
    ];
    
    const hash = participant.userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    return colors[Math.abs(hash) % colors.length];
  }
}