import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel, isParticipantVideoLoading as isVideoLoadingSel, isVideoTrackLive } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';
import { ParticipantUIService } from '../services/participant-ui.service';

@Component({
  selector: 'app-video-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-grid.html',
  styleUrls: ['./video-grid.css']
})
export class VideoGridComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked {
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream;
  @Input() remoteStreams: Map<string, MediaStream> = new Map();
  @Input() meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };
  // ✅ CLEANED: Removed unused input property

  participants: Participant[] = [];

  @ViewChildren('remoteVideo') remoteVideos!: QueryList<ElementRef<HTMLVideoElement>>;

  private participantsSubscription?: Subscription;
  private readonly logUi = ((): boolean => {
    try { return localStorage.getItem('log.ui') === 'true'; } catch { return false; }
  })();

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService,
    private participantUI: ParticipantUIService
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
      
      this.scheduleChangeDetection();
    });
  }

  ngAfterViewInit() {
    // Clear all remote video elements AFTER ViewChild is initialized
    if (this.remoteVideos) {
      this.remoteVideos.forEach(videoRef => {
        const el = videoRef.nativeElement;
        el.pause();
        el.srcObject = null;
        el.load();
      });
    }
    
    this.scheduleChangeDetection();
  }

  ngOnDestroy() {
    this.participantsSubscription?.unsubscribe();
    
    // Clear all video elements on destroy
    if (this.remoteVideos) {
      this.remoteVideos.forEach(videoRef => {
        const el = videoRef.nativeElement;
        el.pause();
        el.srcObject = null;
        el.load();
      });
    }
  }

  ngOnChanges() {
    // Trigger change detection when inputs change (streams, meeting state, etc.)
    this.scheduleChangeDetection();
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

  // ✅ CLEANED: Removed duplicate methods - using unified service

  trackByUserId(index: number, item: Participant) {
    return item.userId;
  }

  onVideoLoaded(event: Event, participant: Participant) {
    const video = event.target as HTMLVideoElement;
    // Force play the video
    video.play().catch(error => {
      console.error(`Failed to play video for ${participant.name}:`, error);
    });
  }

  onVideoError(event: Event, participant: Participant) {
    console.error(`Video error for ${participant.name}:`, event);
  }
  
  // ✅ OPTIMIZED: Unified video update with throttling
  private videoUpdateScheduled = false;
  
  ngAfterViewChecked() {
    if (!this.remoteVideos || this.videoUpdateScheduled) return;
    
    this.videoUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.updateVideoElements();
      this.videoUpdateScheduled = false;
    });
  }
  
  // ✅ OPTIMIZED: Single change detection per component
  private scheduleChangeDetection() {
    if (this.changeDetectionScheduled) return;
    
    this.changeDetectionScheduled = true;
    requestAnimationFrame(() => {
      this.scheduleChangeDetection();
      this.changeDetectionScheduled = false;
    });
  }
  
  private changeDetectionScheduled = false;
  
  private updateVideoElements() {
    this.remoteVideos.forEach(videoRef => {
      const videoElement = videoRef.nativeElement;
      const userId = videoElement.getAttribute('data-user-id');
      
      if (userId) {
        const participant = this.participants.find(p => p.userId === userId);
        if (participant) {
          this.updateSingleVideoElement(videoElement, userId, participant);
        }
      }
    });
  }
  
  // ✅ UNIFIED: Single video element update logic
  private updateSingleVideoElement(videoElement: HTMLVideoElement, userId: string, participant: Participant) {
    let stream: MediaStream | undefined;
    
    if (userId === this.currentUserId) {
      stream = this.localStream;
    } else {
      stream = this.remoteStreams.get(userId);
    }
    
    if (stream && stream.getVideoTracks().length > 0) {
      const videoTrack = stream.getVideoTracks()[0];
      const isTrackLive = isVideoTrackLive(stream);
      
      if (isTrackLive && videoElement.srcObject !== stream) {
        console.log(`🎬 Setting srcObject for ${participant.name}:`, {
          userId,
          streamId: stream.id,
          videoTracks: stream.getVideoTracks().length,
          trackReadyState: videoTrack.readyState,
          trackEnabled: videoTrack.enabled,
          trackMuted: videoTrack.muted
        });
        
        videoElement.srcObject = stream;
        videoElement.play().catch(error => {
          console.error(`Failed to play video for ${participant.name}:`, error);
        });
      } else if (videoElement.srcObject && !isTrackLive) {
        videoElement.srcObject = null;
      }
    } else if (videoElement.srcObject) {
      videoElement.srcObject = null;
    }
  }
  
  // ✅ UNIFIED: Use service methods instead of duplicates
  isParticipantVideoVisible(participant: Participant): boolean {
    return isVisibleSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
  }
  
  isVideoLoading(participant: Participant): boolean {
    return isVideoLoadingSel(participant, this.currentUserId, this.localStream, this.remoteStreams);
  }
  
  getParticipantBackgroundColor(participant: Participant): string {
    return this.participantUI.getParticipantBackgroundColor(participant);
  }
  
  getParticipantInitials(participant: Participant): string {
    return this.participantUI.getParticipantInitials(participant);
  }
  
  getParticipantDisplayName(participant: Participant): string {
    return this.participantUI.getParticipantDisplayName(participant, this.currentUserId);
  }
  
  toggleParticipantMute(participant: Participant): void {
    // TODO: Implement host mute/unmute functionality
    console.log('Toggle mute for participant:', participant.name);
  }
  
  toggleParticipantVideo(participant: Participant): void {
    // TODO: Implement host video on/off functionality
    console.log('Toggle video for participant:', participant.name);
  }
}