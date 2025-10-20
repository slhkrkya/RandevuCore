import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel, selectActiveSpeaker as selectSpeakerSel, isParticipantVideoLoading as isVideoLoadingSel, isVideoTrackLive } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';
import { ParticipantUIService } from '../services/participant-ui.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ParticipantVolumeService } from '../../../../core/services/participant-volume.service';

@Component({
  selector: 'app-speaker-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speaker-view.html',
  styleUrls: ['./speaker-view.css']
})
export class SpeakerViewComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, AfterViewChecked {
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
  private participantsSubscription?: Subscription;
  private lastVideoStates = new Map<string, boolean>();
  pinnedUserId: string | null = null;

  @ViewChild('mainVideo') mainVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('mainAudio') mainAudio?: ElementRef<HTMLAudioElement>;
  @ViewChildren('thumbnailVideo') thumbnailVideos!: QueryList<ElementRef<HTMLVideoElement>>;
  @ViewChildren('thumbnailAudio') thumbnailAudios!: QueryList<ElementRef<HTMLAudioElement>>;

  private settings = inject(SettingsService);

  // Mirror preview from settings
  mirrorPreview = computed(() => this.settings.settings().videoBackground.mirrorPreview ?? true);

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService,
    private participantUI: ParticipantUIService,
    public participantVolume: ParticipantVolumeService
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
            // Active speaker debug info (production-safe)
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
    
    if (this.mainAudio?.nativeElement) {
      const el = this.mainAudio.nativeElement;
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
    
    if (this.thumbnailAudios) {
      this.thumbnailAudios.forEach(audioRef => {
        const el = audioRef.nativeElement;
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
    
    if (this.mainAudio?.nativeElement) {
      const el = this.mainAudio.nativeElement;
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
    
    if (this.thumbnailAudios) {
      this.thumbnailAudios.forEach(audioRef => {
        const el = audioRef.nativeElement;
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
    const defaultMeetingState: MeetingState = {
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      isWhiteboardActive: false
    };
    return getStreamSel(participant, this.currentUserId, this.meetingState || defaultMeetingState, this.localStream || undefined, this.remoteStreams || new Map());
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
  // Context volume state
  contextVolumeUserId: string | null = null;
  contextVolumeValue = 100;
  
  private updateAllVideoElements() {
    this.updateMainVideo();
    this.updateMainAudio();
    this.updateThumbnailVideos();
    this.updateThumbnailAudios();
  }
  
  // ✅ UNIFIED: Main audio update logic
  private updateMainAudio() {
    if (!this.mainAudio) return;
    
    const activeSpeaker = this.getActiveSpeaker();
    if (!activeSpeaker) return;
    
    const stream = this.getStreamForParticipant(activeSpeaker);
    const audioElement = this.mainAudio.nativeElement;
    
    if (stream && stream.getAudioTracks().length > 0) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack.readyState === 'live' && audioElement.srcObject !== stream) {
        audioElement.srcObject = stream;
        audioElement.play().catch(error => {
          // Audio play failed
        });
      }
      // Apply per-user volume for main
      const activeSpeaker = this.getActiveSpeaker();
      if (activeSpeaker) {
        audioElement.volume = this.participantVolume.getVolume(activeSpeaker.userId);
      }
    } else if (audioElement.srcObject) {
      audioElement.srcObject = null;
    }
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
  
  // ✅ UNIFIED: Thumbnail audios update logic
  private updateThumbnailAudios() {
    if (!this.thumbnailAudios) return;
    
    this.thumbnailAudios.forEach(audioRef => {
      const audioElement = audioRef.nativeElement;
      const userId = audioElement.getAttribute('data-user-id');
      
      if (userId) {
        const participant = this.participants.find(p => p.userId === userId);
        if (participant) {
          const stream = this.getStreamForParticipant(participant);
          
          if (stream && stream.getAudioTracks().length > 0) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack.readyState === 'live' && audioElement.srcObject !== stream) {
              audioElement.srcObject = stream;
              audioElement.play().catch(error => {
                // Audio play failed
              });
            }
            // Apply per-user volume for thumbnails
            audioElement.volume = this.participantVolume.getVolume(participant.userId);
          } else if (audioElement.srcObject) {
            audioElement.srcObject = null;
          }
        }
      }
    });
  }

  openVolumeMenu(event: MouseEvent, participant: Participant) {
    event.preventDefault();
    this.contextVolumeUserId = participant.userId;
    this.contextVolumeValue = Math.round(this.participantVolume.getVolume(participant.userId) * 100);
    this.cdr.markForCheck();
  }

  onVolumeChange(userId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    this.contextVolumeValue = value;
    this.participantVolume.setVolume(userId, value / 100);
    this.updateThumbnailAudios();
    this.updateMainAudio();
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
      
      // ✅ FIXED: Show video if track exists (not just if live)
      // This fixes the issue where video doesn't show immediately when camera is turned on
      if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        
        // Remove CSS transform since mirror is now handled by video effects service
        videoElement.style.transform = 'none';
        
        videoElement.play().catch(error => {
          // Video play failed - this is normal during transitions
        });
      }
    } else if (videoElement.srcObject) {
      // ✅ FIXED: Clear video when no stream or no video tracks
      videoElement.srcObject = null;
    }
    
    // ✅ FIXED: Force change detection for video element updates
    this.cdr.markForCheck();
  }
  
  // ✅ UNIFIED: Get stream for participant
  private getStreamForParticipant(participant: Participant): MediaStream | undefined {
    if (participant.userId === this.currentUserId) {
      return this.localStream || undefined;
    } else {
      return this.remoteStreams?.get(participant.userId);
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
  
  getActiveSpeaker(): Participant | null {
    if (this.participants.length === 0) return null;

    // Manual pin override if target participant exists
    if (this.pinnedUserId) {
      const pinned = this.participants.find(p => p.userId === this.pinnedUserId);
      if (pinned) return pinned;
    }
    
    const defaultMeetingState: MeetingState = {
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      isWhiteboardActive: false
    };
    return selectSpeakerSel(this.participants, this.currentUserId, this.meetingState || defaultMeetingState, this.localStream || undefined, this.remoteStreams || new Map());
  }
  
  getActiveSpeakerStream(): MediaStream | null {
    const activeSpeaker = this.getActiveSpeaker();
    if (!activeSpeaker) return null;
    
    const defaultMeetingState: MeetingState = {
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      isWhiteboardActive: false
    };
    return getStreamSel(activeSpeaker, this.currentUserId, this.meetingState || defaultMeetingState, this.localStream || undefined, this.remoteStreams || new Map()) || null;
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
