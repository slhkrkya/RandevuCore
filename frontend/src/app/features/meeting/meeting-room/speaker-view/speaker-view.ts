import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel, selectActiveSpeaker as selectSpeakerSel, isParticipantVideoLoading as isVideoLoadingSel, isVideoTrackLive } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';
import { ParticipantUIService } from '../services/participant-ui.service';

@Component({
  selector: 'app-speaker-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speaker-view.html',
  styleUrls: ['./speaker-view.css']
})
export class SpeakerViewComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, AfterViewChecked {
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
  private participantsSubscription?: Subscription;
  private lastVideoStates = new Map<string, boolean>();
  pinnedUserId: string | null = null;

  @ViewChild('mainVideo') mainVideo?: ElementRef<HTMLVideoElement>;
  @ViewChildren('thumbnailVideo') thumbnailVideos!: QueryList<ElementRef<HTMLVideoElement>>;

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService,
    private participantUI: ParticipantUIService
  ) {}

  private readonly logUi = ((): boolean => {
    try { return localStorage.getItem('log.ui') === 'true'; } catch { return false; }
  })();

  ngOnInit() {
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      
      this.participants = participants;
      
      // Debug active speaker and visibility
      if (this.logUi) {
        setTimeout(() => {
          const activeSpeaker = this.getActiveSpeaker();
          if (activeSpeaker) {
            const stream = this.getActiveSpeakerStream();
            const isVisible = this.isParticipantVideoVisible(activeSpeaker);
            console.log(`🎯 Active Speaker Debug:`, {
              userId: activeSpeaker.userId,
              name: activeSpeaker.name,
              isVideoOn: activeSpeaker.isVideoOn,
              isScreenSharing: activeSpeaker.isScreenSharing,
              isVisible,
              hasStream: !!stream,
              streamId: stream?.id,
              videoTracks: stream?.getVideoTracks().length || 0
            });
          }
        }, 100);
      }
      
      // Force change detection synchronously
      this.cdr.markForCheck();
      this.scheduleChangeDetection();
    });
  }

  ngAfterViewInit() {
    // Clear all video elements AFTER ViewChild is initialized
    if (this.mainVideo?.nativeElement) {
      const el = this.mainVideo.nativeElement;
      el.pause();
      el.srcObject = null;
      el.load();
    }
    
    if (this.thumbnailVideos) {
      this.thumbnailVideos.forEach(videoRef => {
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
    this.lastVideoStates.clear(); // Prevent memory leak
    
    // Clear all video elements on destroy
    if (this.mainVideo?.nativeElement) {
      const el = this.mainVideo.nativeElement;
      el.pause();
      el.srcObject = null;
      el.load();
    }
    
    if (this.thumbnailVideos) {
      this.thumbnailVideos.forEach(videoRef => {
        const el = videoRef.nativeElement;
        el.pause();
        el.srcObject = null;
        el.load();
      });
    }
  }

  ngOnChanges() {
    // debug log removed in production build
  }

  // ✅ CLEANED: Removed duplicate methods - using unified service
  
  private shouldLogVideoState(userId: string, currentState: boolean): boolean {
    const lastState = this.lastVideoStates.get(userId);
    this.lastVideoStates.set(userId, currentState);
    return lastState !== currentState;
  }

  getParticipantStream(participant: Participant): MediaStream | undefined {
    return getStreamSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
  }

  trackByUserId(index: number, item: Participant) {
    return item.userId;
  }

  // ✅ CLEANED: Removed duplicate methods - using unified versions below

  onMainVideoLoaded(event: Event) {
    const video = event.target as HTMLVideoElement;
    const activeSpeaker = this.getActiveSpeaker();
    // debug log removed in production build
    
    // Force play the video
    video.play().catch(error => {
    });
  }

  onMainVideoError(event: Event) {
    const activeSpeaker = this.getActiveSpeaker();
    // handled silently to avoid console noise
  }

  onThumbnailVideoLoaded(event: Event, participant: Participant) {
    const video = event.target as HTMLVideoElement;
    
    // Force play the video
    video.play().catch(error => {
    });
  }

  onThumbnailVideoError(event: Event, participant: Participant) {
    // handled silently to avoid console noise
  }
  
  // ✅ OPTIMIZED: Unified video update with throttling
  private videoUpdateScheduled = false;
  
  ngAfterViewChecked() {
    if (this.videoUpdateScheduled) return;
    
    this.videoUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.updateAllVideoElements();
      this.videoUpdateScheduled = false;
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
  
  private updateAllVideoElements() {
    this.updateMainVideo();
    this.updateThumbnailVideos();
  }
  
  // ✅ UNIFIED: Main video update logic
  private updateMainVideo() {
    if (!this.mainVideo) return;
    
    const activeSpeaker = this.getActiveSpeaker();
    if (!activeSpeaker) return;
    
    const stream = this.getStreamForParticipant(activeSpeaker);
    const videoElement = this.mainVideo.nativeElement;
    
    this.updateSingleVideoElement(videoElement, stream, activeSpeaker, 'main');
  }
  
  // ✅ UNIFIED: Thumbnail videos update logic
  private updateThumbnailVideos() {
    if (!this.thumbnailVideos) return;
    
    this.thumbnailVideos.forEach(videoRef => {
      const videoElement = videoRef.nativeElement;
      const userId = videoElement.getAttribute('data-user-id');
      
      if (userId) {
        const participant = this.participants.find(p => p.userId === userId);
        if (participant) {
          const stream = this.getStreamForParticipant(participant);
          this.updateSingleVideoElement(videoElement, stream, participant, 'thumbnail');
        }
      }
    });
  }
  
  // ✅ UNIFIED: Single video element update logic
  private updateSingleVideoElement(videoElement: HTMLVideoElement, stream: MediaStream | undefined, participant: Participant, type: 'main' | 'thumbnail') {
    if (stream && stream.getVideoTracks().length > 0) {
      const videoTrack = stream.getVideoTracks()[0];
      const isTrackLive = isVideoTrackLive(stream);
      
      if (isTrackLive && videoElement.srcObject !== stream) {
        console.log(`🎬 Setting ${type} video srcObject for ${participant.name}:`, {
          userId: participant.userId,
          streamId: stream.id,
          videoTracks: stream.getVideoTracks().length,
          trackReadyState: videoTrack.readyState,
          trackEnabled: videoTrack.enabled,
          trackMuted: videoTrack.muted
        });
        
        videoElement.srcObject = stream;
        videoElement.play().catch(error => {
          console.error(`Failed to play ${type} video for ${participant.name}:`, error);
        });
      } else if (videoElement.srcObject && !isTrackLive) {
        videoElement.srcObject = null;
      }
    } else if (videoElement.srcObject) {
      videoElement.srcObject = null;
    }
  }
  
  // ✅ UNIFIED: Get stream for participant
  private getStreamForParticipant(participant: Participant): MediaStream | undefined {
    if (participant.userId === this.currentUserId) {
      return this.localStream;
    } else {
      return this.remoteStreams.get(participant.userId);
    }
  }
  
  // ✅ UNIFIED: Use service methods instead of duplicates
  isParticipantVideoVisible(participant: Participant): boolean {
    return isVisibleSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
  }
  
  isVideoLoading(participant: Participant): boolean {
    return isVideoLoadingSel(participant, this.currentUserId, this.localStream, this.remoteStreams);
  }
  
  getActiveSpeaker(): Participant | null {
    if (this.participants.length === 0) return null;

    // Manual pin override if target participant exists
    if (this.pinnedUserId) {
      const pinned = this.participants.find(p => p.userId === this.pinnedUserId);
      if (pinned) return pinned;
    }
    
    return selectSpeakerSel(this.participants, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
  }
  
  getActiveSpeakerStream(): MediaStream | null {
    const activeSpeaker = this.getActiveSpeaker();
    if (!activeSpeaker) return null;
    return getStreamSel(activeSpeaker, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams) || null;
  }
  
  getOtherParticipants(): Participant[] {
    const activeSpeaker = this.getActiveSpeaker();
    return this.participants.filter(p => p.userId !== activeSpeaker?.userId).slice(0, 4);
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
  
  togglePin(participant: Participant): void {
    if (!participant) return;
    if (this.pinnedUserId === participant.userId) {
      this.pinnedUserId = null;
    } else {
      this.pinnedUserId = participant.userId;
    }
    this.scheduleChangeDetection();
  }
  
  isPinned(participant: Participant): boolean {
    if (!participant) return false;
    return this.pinnedUserId === participant.userId;
  }
}
