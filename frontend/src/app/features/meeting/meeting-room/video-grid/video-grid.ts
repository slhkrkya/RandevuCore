import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';

@Component({
  selector: 'app-video-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-grid.html',
  styleUrls: ['./video-grid.css']
})
export class VideoGridComponent implements OnInit, OnDestroy, AfterViewChecked {
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
  @ViewChildren('remoteVideo') remoteVideos!: QueryList<ElementRef<HTMLVideoElement>>;

  private participantsSubscription?: Subscription;
  private readonly logUi = ((): boolean => {
    try { return localStorage.getItem('log.ui') === 'true'; } catch { return false; }
  })();

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService
  ) {}

  ngOnInit() {
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      
      this.participants = participants;
      
      if (this.logUi) {
        setTimeout(() => {
          participants.forEach(p => {
            if (this.isParticipantVideoVisible(p)) {
              this.getParticipantVideo(p);
            }
          });
        }, 100);
      }
      
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
        const track = this.localStream.getVideoTracks()[0];
        // Verify track is ready before setting srcObject
        if (track.readyState !== 'live') {
          console.warn('Local video track not live yet, waiting...');
          setTimeout(() => this.updateLocalVideo(), 100);
          return;
        }
        
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
    const s = getStreamSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
    return s || null;
  }

  toggleParticipantMute(participant: Participant) {
    // This would be handled by the parent component
  }

  toggleParticipantVideo(participant: Participant) {
    // This would be handled by the parent component
  }

  isParticipantVideoVisible(participant: Participant): boolean {
    return isVisibleSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
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

  trackByUserId(index: number, item: Participant) {
    return item.userId;
  }

  onVideoLoaded(event: Event, participant: Participant) {
    const video = event.target as HTMLVideoElement;
    
    console.log(`📹 Video loaded for ${participant.name}:`, {
      userId: participant.userId,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      srcObject: !!video.srcObject
    });
    
    // Force play the video
    video.play().catch(error => {
      console.error(`Failed to play video for ${participant.name}:`, error);
    });
  }

  onVideoError(event: Event, participant: Participant) {
    console.error(`Video error for ${participant.name}:`, event);
  }
  
  // Manually set srcObject for remote videos when stream changes
  ngAfterViewChecked() {
    if (!this.remoteVideos) return;
    
    // Update video elements with correct streams
    this.remoteVideos.forEach(videoRef => {
      const videoElement = videoRef.nativeElement;
      const userId = videoElement.getAttribute('data-user-id');
      
      if (userId) {
        const participant = this.participants.find(p => p.userId === userId);
        if (participant && this.isParticipantVideoVisible(participant)) {
          const stream = this.getParticipantVideo(participant);
          
          // Only update if stream is different
          if (stream && videoElement.srcObject !== stream) {
            console.log(`🎬 Setting srcObject for ${participant.name}:`, {
              userId,
              streamId: stream.id,
              videoTracks: stream.getVideoTracks().length,
              audioTracks: stream.getAudioTracks().length
            });
            
            videoElement.srcObject = stream;
            videoElement.play().catch(error => {
              console.error(`Failed to play video for ${participant.name}:`, error);
            });
          }
        }
      }
    });
  }
}