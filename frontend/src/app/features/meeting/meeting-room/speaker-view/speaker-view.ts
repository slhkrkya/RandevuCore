import { Component, Input, ViewChild, ElementRef, ChangeDetectorRef, OnInit, OnDestroy, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant, MeetingState } from '../meeting-room';
import { ParticipantService } from '../services/participant.service';

@Component({
  selector: 'app-speaker-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speaker-view.html',
  styleUrls: ['./speaker-view.css']
})
export class SpeakerViewComponent implements OnInit, OnDestroy, OnChanges {
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

  @ViewChild('mainVideo', { static: true }) mainVideo!: ElementRef<HTMLVideoElement>;

  constructor(
    private cdr: ChangeDetectorRef,
    private participantService: ParticipantService
  ) {}

  ngOnInit() {
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      console.log(`SpeakerView: Participants updated:`, participants.length, participants.map(p => ({
        userId: p.userId,
        name: p.name,
        isVideoOn: p.isVideoOn,
        isScreenSharing: p.isScreenSharing,
        isMuted: p.isMuted
      })));
      
      this.participants = participants;
      
      // Debug active speaker and visibility
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
            videoTracks: stream?.getVideoTracks().length || 0,
            trackStates: stream?.getVideoTracks().map(t => ({ 
              enabled: t.enabled, 
              muted: t.muted, 
              readyState: t.readyState 
            })) || []
          });
          
          // Debug for template conditions
          console.log(`🎯 Template Conditions Debug:`, {
            'getActiveSpeaker()': !!activeSpeaker,
            'isParticipantVideoVisible(getActiveSpeaker()!)': isVisible,
            'Show video element': !!activeSpeaker && isVisible,
            'Show placeholder': !activeSpeaker || !isVisible
          });
        }
      }, 100);
      
      // Force change detection synchronously
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.participantsSubscription?.unsubscribe();
  }

  ngOnChanges() {
    console.log(`🔄 SpeakerView Inputs Changed:`, {
      hasLocalStream: !!this.localStream,
      localStreamId: this.localStream?.id,
      localVideoTracks: this.localStream?.getVideoTracks().length || 0,
      remoteStreamsCount: this.remoteStreams.size,
      meetingState: {
        isVideoOn: this.meetingState.isVideoOn,
        isScreenSharing: this.meetingState.isScreenSharing,
        isMuted: this.meetingState.isMuted
      }
    });
  }

  getActiveSpeaker(): Participant | null {
    if (this.participants.length === 0) return null;

    // Priority algorithm for speaker selection
    // 1. Screen sharing participants (highest priority)
    const screenSharingParticipants = this.participants.filter(p => p.isScreenSharing);
    if (screenSharingParticipants.length > 0) {
      return screenSharingParticipants[0];
    }

    // 2. Video enabled + speaking participants
    const videoSpeakingParticipants = this.participants.filter(p => 
      this.isParticipantVideoVisible(p) && 
      p.userId === this.meetingState.activeSpeaker
    );
    if (videoSpeakingParticipants.length > 0) {
      return videoSpeakingParticipants[0];
    }

    // 3. Video enabled participants (regardless of speaking)
    const videoParticipants = this.participants.filter(p => this.isParticipantVideoVisible(p));
    if (videoParticipants.length > 0) {
      return videoParticipants[0];
    }

    // 4. Speaking participants (regardless of video status)
    if (this.meetingState.activeSpeaker) {
      const speakingParticipant = this.participants.find(p => p.userId === this.meetingState.activeSpeaker);
      if (speakingParticipant) {
        return speakingParticipant;
      }
    }

    // 5. Default to first participant
    return this.participants[0];
  }

  getActiveSpeakerStream(): MediaStream | null {
    const activeSpeaker = this.getActiveSpeaker();
    if (!activeSpeaker) return null;

    if (activeSpeaker.userId === this.currentUserId) {
      return this.localStream || null;
    }
    return this.remoteStreams.get(activeSpeaker.userId) || null;
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
    if (participant.userId === this.currentUserId) {
      // For local user, check if video is on OR screen sharing and we have an active video track
      const videoTrack = this.localStream?.getVideoTracks()[0];
      const hasActiveVideoTrack = !!(this.localStream && 
                                    videoTrack && 
                                    !videoTrack.muted && 
                                    videoTrack.readyState === 'live');
      const isVideoVisible = !!(hasActiveVideoTrack && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing));
      
      // Debug logging for local user video state (only when state changes)
      if (this.shouldLogVideoState(participant.userId, isVideoVisible)) {
        console.log(`Local user video state changed:`, {
          userId: participant.userId,
          isVideoOn: this.meetingState.isVideoOn,
          isScreenSharing: this.meetingState.isScreenSharing,
          hasLocalStream: !!this.localStream,
          hasVideoTrack: !!videoTrack,
          trackMuted: videoTrack?.muted,
          trackReadyState: videoTrack?.readyState,
          finalResult: isVideoVisible
        });
      }
      
      return isVideoVisible;
    }
    
    // For remote participants, check if they have video on AND we have an active video track
    const remoteStream = this.remoteStreams.get(participant.userId);
    const videoTrack = remoteStream?.getVideoTracks()[0];
    const hasActiveVideoTrack = !!(videoTrack && 
                                  !videoTrack.muted && 
                                  videoTrack.readyState === 'live');
    
    const isRemoteVideoVisible = !!(hasActiveVideoTrack && (participant.isVideoOn || participant.isScreenSharing));
    
    // Debug logging for remote participant video state (only when state changes)
    if (this.shouldLogVideoState(participant.userId, isRemoteVideoVisible)) {
      console.log(`Remote participant video state changed:`, {
        userId: participant.userId,
        isVideoOn: participant.isVideoOn,
        isScreenSharing: participant.isScreenSharing,
        hasRemoteStream: !!remoteStream,
        hasVideoTrack: !!videoTrack,
        trackMuted: videoTrack?.muted,
        trackReadyState: videoTrack?.readyState,
        finalResult: isRemoteVideoVisible
      });
    }
    
    // Trigger change detection when stream state changes (for both video and screen share)
    if ((participant.isVideoOn || participant.isScreenSharing) !== hasActiveVideoTrack) {
      console.log(`Triggering change detection for ${participant.userId}`);
      setTimeout(() => this.cdr.detectChanges(), 100);
    }
    
    return isRemoteVideoVisible;
  }

  private shouldLogVideoState(userId: string, currentState: boolean): boolean {
    const lastState = this.lastVideoStates.get(userId);
    this.lastVideoStates.set(userId, currentState);
    return lastState !== currentState;
  }

  getParticipantStream(participant: Participant): MediaStream | undefined {
    if (participant.userId === this.currentUserId) {
      console.log(`📱 Local Stream Debug:`, {
        userId: participant.userId,
        hasLocalStream: !!this.localStream,
        streamId: this.localStream?.id,
        videoTracks: this.localStream?.getVideoTracks().length || 0,
        localVideoOn: this.meetingState.isVideoOn,
        localScreenSharing: this.meetingState.isScreenSharing
      });
      return this.localStream;
    }
    
    const remoteStream = this.remoteStreams.get(participant.userId);
    console.log(`📡 Remote Stream Debug for ${participant.userId}:`, {
      hasStream: !!remoteStream,
      streamId: remoteStream?.id,
      videoTracks: remoteStream?.getVideoTracks().length || 0,
      audioTracks: remoteStream?.getAudioTracks().length || 0,
      participantVideoOn: participant.isVideoOn,
      participantScreenSharing: participant.isScreenSharing
    });
    
    return remoteStream;
  }

  getParticipantDisplayName(participant: Participant): string {
    if (participant.userId === this.currentUserId) {
      return 'You';
    }
    return participant.name;
  }
}
