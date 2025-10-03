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
      console.log(`📊 VideoGrid: Participants updated:`, participants.map(p => ({
        userId: p.userId,
        name: p.name,
        isVideoOn: p.isVideoOn,
        isScreenSharing: p.isScreenSharing,
        isVisible: this.isParticipantVideoVisible(p),
        hasVideo: !!this.getParticipantVideo(p)
      })));
      
      this.participants = participants;
      
      // Debug each participant's video visibility
      setTimeout(() => {
        participants.forEach(p => {
          if (this.isParticipantVideoVisible(p)) {
            const video = this.getParticipantVideo(p);
            console.log(`📺 VideoGrid Participant Visible:`, {
              userId: p.userId,
              name: p.name,
              isVideoOn: p.isVideoOn,
              isScreenSharing: p.isScreenSharing,
              hasVideo: !!video,
              videoId: video?.id,
              videoTracks: video?.getVideoTracks().length || 0
            });
          }
        });
      }, 100);
      
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
        const el = this.localVideo.nativeElement;
        el.srcObject = this.localStream;
        el.muted = true;
        (el as any).playsInline = true;
        el.autoplay = true;
        try { el.play(); } catch {}
        // tiny retry to avoid race in SPA navigations
        setTimeout(() => { try { el.play(); } catch {} }, 50);
      } else {
        // Clear video element when no video track
        this.localVideo.nativeElement.srcObject = null;
      }
    }
  }

  getVideoGridClass(): string {
    const totalParticipants = this.participants.length;
    
    if (totalParticipants <= 1) {
      return 'grid-cols-1 gap-4 max-w-4xl mx-auto';
    }
  if (totalParticipants <= 2) {
    return 'grid-cols-2 gap-x-6 gap-y-6 max-w-4xl mx-auto items-center justify-center';
  }
  if (totalParticipants <= 4) {
    return 'grid-cols-2 gap-4 gap-y-4 max-w-4xl mx-auto';
  }
  if (totalParticipants <= 6) {
    return 'grid-cols-3 gap-3 gap-y-3 max-w-4xl mx-auto';
  }
  if (totalParticipants <= 9) {
    return 'grid-cols-3 gap-2 gap-y-2 max-w-3xl mx-auto';
  }
    return 'grid-cols-4 gap-2 gap-y-2 max-w-4xl mx-auto';
  }

  getParticipantVideo(participant: Participant): MediaStream | null {
    if (participant.userId === this.currentUserId) {
      // For local user, return stream if video OR screen sharing is on and has video tracks
      if ((!!this.meetingState.isVideoOn || !!this.meetingState.isScreenSharing) && 
          this.localStream && this.localStream.getVideoTracks().length > 0) {
        return this.localStream;
      }
      return null;
    }
    
    const remoteStream = this.remoteStreams.get(participant.userId);
    // For remote users, return stream if they have video OR screen sharing on and stream has video tracks
    if ((!!participant.isVideoOn || !!participant.isScreenSharing) && 
        remoteStream && remoteStream.getVideoTracks().length > 0) {
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
      // For local user, check if video is on OR screen sharing and we have a video track
      const hasStreamData = !!(this.localStream && 
                              this.localStream.getVideoTracks().length > 0);
      return !!(hasStreamData && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing));
    }
    
    // For remote participants, check if they have video on OR screen sharing AND we have their stream with video tracks
    const remoteStream = this.remoteStreams.get(participant.userId);
    const hasVideoTrack = !!(remoteStream && remoteStream.getVideoTracks().length > 0);
    
    // Check both video and screen sharing status
    return !!(hasVideoTrack && (participant.isVideoOn || participant.isScreenSharing));
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
    // Generate consistent color based on user ID - modern gradient colors
    const colors = [
      'bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800',
      'bg-gradient-to-br from-emerald-600 to-emerald-700 dark:from-emerald-700 dark:to-emerald-800',
      'bg-gradient-to-br from-purple-600 to-purple-700 dark:from-purple-700 dark:to-purple-800',
      'bg-gradient-to-br from-pink-600 to-pink-700 dark:from-pink-700 dark:to-pink-800',
      'bg-gradient-to-br from-indigo-600 to-indigo-700 dark:from-indigo-700 dark:to-indigo-800',
      'bg-gradient-to-br from-amber-600 to-amber-700 dark:from-amber-700 dark:to-amber-800',
      'bg-gradient-to-br from-red-600 to-red-700 dark:from-red-700 dark:to-red-800',
      'bg-gradient-to-br from-teal-600 to-teal-700 dark:from-teal-700 dark:to-teal-800',
      'bg-gradient-to-br from-slate-600 to-slate-700 dark:from-slate-700 dark:to-slate-800',
      'bg-gradient-to-br from-orange-600 to-orange-700 dark:from-orange-700 dark:to-orange-800',
      'bg-gradient-to-br from-cyan-600 to-cyan-700 dark:from-cyan-700 dark:to-cyan-800',
      'bg-gradient-to-br from-violet-600 to-violet-700 dark:from-violet-700 dark:to-violet-800'
    ];
    
    const hash = participant.userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    return colors[Math.abs(hash) % colors.length];
  }
}