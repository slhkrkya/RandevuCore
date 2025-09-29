import { Component, Input, ViewChild, ElementRef, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { ParticipantService } from '../services/participant.service';

@Component({
  selector: 'app-video-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-grid.html',
  styleUrls: ['./video-grid.css']
})
export class VideoGridComponent implements OnInit, OnDestroy {
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream;
  @Input() remoteStreams: Map<string, MediaStream> = new Map();
  @Input() meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };

  participants: Participant[] = [];

  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;

  private participantsSubscription?: Subscription;

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService
  ) {}

  ngOnInit() {
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
      this.cdr.detectChanges();
    });
  }

  ngAfterViewInit() {
    this.updateLocalVideo();
  }

  ngOnDestroy() {
    this.participantsSubscription?.unsubscribe();
  }

  ngOnChanges() {
    this.updateLocalVideo();
    this.cdr.detectChanges(); // Force change detection to update video elements
  }

  private updateLocalVideo() {
    if (this.localVideo) {
      if (this.localStream && this.localStream.getVideoTracks().length > 0) {
        this.localVideo.nativeElement.srcObject = this.localStream;
      } else {
        // Clear video element when no video track
        this.localVideo.nativeElement.srcObject = null;
      }
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
      // For local user, only return stream if video is on and has video tracks
      if (!!this.meetingState.isVideoOn && this.localStream && this.localStream.getVideoTracks().length > 0) {
        return this.localStream;
      }
      return null;
    }
    
    const remoteStream = this.remoteStreams.get(participant.userId);
    // For remote users, only return stream if they have video on and stream has video tracks
    if (!!participant.isVideoOn && remoteStream && remoteStream.getVideoTracks().length > 0) {
      return remoteStream;
    }
    return null;
  }

  toggleParticipantMute(participant: Participant) {
    // This would be handled by the parent component
  }

  toggleParticipantVideo(participant: Participant) {
    // This would be handled by the parent component
  }

  isParticipantVideoVisible(participant: Participant): boolean {
    if (participant.userId === this.currentUserId) {
      // For local user, check if video is on and we have a video track
      return !!(this.meetingState.isVideoOn && 
                this.localStream && 
                this.localStream.getVideoTracks().length > 0);
    }
    
    // For remote participants, check if they have video on AND we have their stream with video tracks
    const remoteStream = this.remoteStreams.get(participant.userId);
    const hasVideoTrack = !!(remoteStream && remoteStream.getVideoTracks().length > 0);
    
    return !!(participant.isVideoOn && hasVideoTrack);
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