import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { isParticipantVideoVisible as isVisibleSel, getStreamForParticipant as getStreamSel, selectActiveSpeaker as selectSpeakerSel } from '../services/media-selectors';
import { ParticipantService } from '../services/participant.service';

@Component({
  selector: 'app-speaker-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speaker-view.html',
  styleUrls: ['./speaker-view.css']
})
export class SpeakerViewComponent implements OnInit, OnDestroy, OnChanges, AfterViewChecked {
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
  private participantsSubscription?: Subscription;
  private lastVideoStates = new Map<string, boolean>();
  pinnedUserId: string | null = null;

  @ViewChild('mainVideo') mainVideo?: ElementRef<HTMLVideoElement>;
  @ViewChildren('thumbnailVideo') thumbnailVideos!: QueryList<ElementRef<HTMLVideoElement>>;

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService
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
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.participantsSubscription?.unsubscribe();
    this.lastVideoStates.clear(); // Prevent memory leak
  }

  ngOnChanges() {
    // debug log removed in production build
  }

  getActiveSpeaker(): Participant | null {
    if (this.participants.length === 0) return null;

    // 0. Manual pin override if target participant exists
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

  getParticipantInitials(participant: Participant): string {
    const name = participant.name || 'User';
    const words = name.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getParticipantBackgroundColor(participant: Participant): string {
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

  isParticipantVideoVisible(participant: Participant): boolean {
    const visible = isVisibleSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
    if (this.shouldLogVideoState(participant.userId, visible)) {
      if (this.logUi) {
        console.log(`Video visibility changed`, participant.userId, visible);
      }
      setTimeout(() => this.cdr.detectChanges(), 100);
    }
    return visible;
  }

  private shouldLogVideoState(userId: string, currentState: boolean): boolean {
    const lastState = this.lastVideoStates.get(userId);
    this.lastVideoStates.set(userId, currentState);
    return lastState !== currentState;
  }

  getParticipantStream(participant: Participant): MediaStream | undefined {
    return getStreamSel(participant, this.currentUserId, this.meetingState, this.localStream, this.remoteStreams);
  }

  getParticipantDisplayName(participant: Participant): string {
    if (participant.userId === this.currentUserId) {
      return 'You';
    }
    return participant.name;
  }

  trackByUserId(index: number, item: Participant) {
    return item.userId;
  }

  togglePin(participant: Participant) {
    if (!participant) return;
    if (this.pinnedUserId === participant.userId) {
      this.pinnedUserId = null;
    } else {
      this.pinnedUserId = participant.userId;
    }
    this.cdr.detectChanges();
  }

  isPinned(participant?: Participant): boolean {
    if (!participant) return false;
    return this.pinnedUserId === participant.userId;
  }

  onMainVideoLoaded(event: Event) {
    const video = event.target as HTMLVideoElement;
    const activeSpeaker = this.getActiveSpeaker();
    // debug log removed in production build
    
    // Force play the video
    video.play().catch(error => {
      console.warn(`Failed to play main video for ${activeSpeaker?.name}:`, error);
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
      console.warn(`Failed to play thumbnail video for ${participant.name}:`, error);
    });
  }

  onThumbnailVideoError(event: Event, participant: Participant) {
    // handled silently to avoid console noise
  }
  
  ngAfterViewChecked() {
    // Update main video srcObject
    if (this.mainVideo) {
      const activeSpeaker = this.getActiveSpeaker();
      if (activeSpeaker && this.isParticipantVideoVisible(activeSpeaker)) {
        const stream = this.getActiveSpeakerStream();
        const videoElement = this.mainVideo.nativeElement;
        
        if (stream && videoElement.srcObject !== stream) {
          console.log(`🎬 Setting main video srcObject for ${activeSpeaker.name}:`, {
            userId: activeSpeaker.userId,
            streamId: stream.id,
            videoTracks: stream.getVideoTracks().length
          });
          
          videoElement.srcObject = stream;
          videoElement.play().catch(error => {
            console.error(`Failed to play main video for ${activeSpeaker.name}:`, error);
          });
        }
      }
    }
    
    // Update thumbnail videos
    if (this.thumbnailVideos) {
      this.thumbnailVideos.forEach(videoRef => {
        const videoElement = videoRef.nativeElement;
        const userId = videoElement.getAttribute('data-user-id');
        
        if (userId) {
          const participant = this.participants.find(p => p.userId === userId);
          if (participant && this.isParticipantVideoVisible(participant)) {
            const stream = this.getParticipantStream(participant);
            
            if (stream && videoElement.srcObject !== stream) {
              console.log(`🎬 Setting thumbnail srcObject for ${participant.name}`);
              videoElement.srcObject = stream;
              videoElement.play().catch(() => {});
            }
          }
        }
      });
    }
  }
}
