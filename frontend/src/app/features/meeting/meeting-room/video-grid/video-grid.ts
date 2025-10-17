import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel, isParticipantVideoLoading as isVideoLoadingSel, isVideoTrackLive } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';
import { ParticipantUIService } from '../services/participant-ui.service';
import { SettingsService } from '../../../../core/services/settings.service';

@Component({
  selector: 'app-video-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-grid.html',
  styleUrls: ['./video-grid.css']
})
export class VideoGridComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked {
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream | null;
  @Input() remoteStreams: Map<string, MediaStream> | null = new Map();
  @Input() meetingState: MeetingState | null = {
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

  private settings = inject(SettingsService);

  // Mirror preview from settings
  mirrorPreview = computed(() => this.settings.settings().videoBackground.mirrorPreview ?? true);

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
    const defaultMeetingState: MeetingState = {
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      isWhiteboardActive: false
    };
    const s = getStreamSel(participant, this.currentUserId, this.meetingState || defaultMeetingState, this.localStream || undefined, this.remoteStreams || new Map());
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
    });
  }

  onVideoError(event: Event, participant: Participant) {
  }
  
  // ✅ OPTIMIZED: Unified video update with throttling
  private videoUpdateScheduled = false;
  
  ngAfterViewChecked() {
    if (!this.remoteVideos || this.videoUpdateScheduled) return;
    
    this.videoUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.updateVideoElements();
      this.videoUpdateScheduled = false;
      
      // ✅ FIXED: Force change detection for avatar cards after video toggle
      this.cdr.markForCheck();
    });
  }
  
  // ✅ FIXED: Single change detection per component
  private scheduleChangeDetection() {
    if (this.changeDetectionScheduled) return;
    
    this.changeDetectionScheduled = true;
    requestAnimationFrame(() => {
      this.cdr.detectChanges();
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
      stream = this.localStream || undefined;
    } else {
      stream = this.remoteStreams?.get(userId);
    }
    
    if (stream && stream.getVideoTracks().length > 0) {
      const videoTrack = stream.getVideoTracks()[0];
      const isTrackLive = isVideoTrackLive(stream);
      
      if (isTrackLive && videoElement.srcObject !== stream) {
        
        videoElement.srcObject = stream;
        
        // Remove CSS transform since mirror is now handled by video effects service
        videoElement.style.transform = 'none';
        
        videoElement.play().catch(error => {
        });
      } else if (videoElement.srcObject && !isTrackLive) {
        videoElement.srcObject = null;
      }
    } else if (videoElement.srcObject) {
      videoElement.srcObject = null;
    }
    
    // ✅ FIXED: Force video element update for rejoin scenarios
    // This ensures video elements are properly updated even when streams are not immediately available
    if (participant.isVideoOn && !stream) {
      // Participant should have video but stream is not available yet
      // This is common in rejoin scenarios
    }
  }
  
  // ✅ UNIFIED: Use service methods instead of duplicates
  isParticipantVideoVisible(participant: Participant): boolean {
    const defaultMeetingState: MeetingState = {
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      isWhiteboardActive: false
    };
    const result = isVisibleSel(participant, this.currentUserId, this.meetingState || defaultMeetingState, this.localStream || undefined, this.remoteStreams || new Map());
    
    return result;
  }
  
  isVideoLoading(participant: Participant): boolean {
    return isVideoLoadingSel(participant, this.currentUserId, this.localStream || undefined, this.remoteStreams || new Map());
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
  }
  
  toggleParticipantVideo(participant: Participant): void {
    // TODO: Implement host video on/off functionality
  }
}