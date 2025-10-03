import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SignalRService } from '../../../core/services/signalr';
import { ParticipantService } from './services/participant.service';
import { VideoGridComponent } from './video-grid/video-grid';
import { SpeakerViewComponent } from './speaker-view/speaker-view';
import { WhiteboardComponent } from './whiteboard/whiteboard';
import { MeetingControlsComponent } from './meeting-controls/meeting-controls';
import { ParticipantsPanelComponent } from './participants-panel/participants-panel';
import { ChatPanelComponent } from './chat-panel/chat-panel';
import { VideoEffectsService } from '../../../core/services/video-effects.service';
import { SettingsService } from '../../../core/services/settings.service';

export interface Participant {
  connectionId: string;
  userId: string;
  name: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isWhiteboardEnabled: boolean;
}

export interface MeetingState {
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isWhiteboardActive: boolean;
  activeSpeaker?: string;
}

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [
    CommonModule,
    VideoGridComponent,
    SpeakerViewComponent,
    WhiteboardComponent,
    MeetingControlsComponent,
    ParticipantsPanelComponent,
    ChatPanelComponent
  ],
  templateUrl: './meeting-room.html',
  styleUrls: ['./meeting-room.css']
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  // Core properties
  meetingId = '';
  roomKey = '';
  currentUserId = '';
  currentUserName = '';
  isHost = false;
  connected = false;

  // Meeting state
  meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };

  // Participants
  participants: Participant[] = [];
  localStream?: MediaStream; // active (processed or raw)
  private rawLocalStream?: MediaStream; // original camera/mic stream for processing
  remoteStreams: Map<string, MediaStream> = new Map();
  peerConnections: Map<string, RTCPeerConnection> = new Map();
  pendingIceCandidates: Map<string, RTCIceCandidate[]> = new Map();

  // UI state
  showParticipantsPanel = false;
  showChatPanel = false;
  showWhiteboardPanel = false;
  isFullscreen = false;
  activeView: 'grid' | 'speaker' | 'whiteboard' = 'grid';

  // Control states to prevent rapid clicking
  isVideoToggling = false;
  isScreenShareToggling = false;
  isMuteToggling = false;

  // Meeting duration tracking
  meetingDuration = '00:00:00';

  // ViewChild references
  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo', { static: true }) remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('controlsBar', { static: true, read: ElementRef }) controlsBar?: ElementRef<HTMLElement>;

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    public signalr: SignalRService,
    private participantService: ParticipantService,
    private cdr: ChangeDetectorRef,
    private videoEffects: VideoEffectsService,
    private settingsService: SettingsService,
    private zone: NgZone
  ) {}

  async ngOnInit() {
    this.initializeMeeting();
    // Preload segmentation to reduce first-frame latency
    try { await this.videoEffects.preload(); } catch {}
    await this.initializeMedia();
    this.recomputeBottomPad();
    window.addEventListener('resize', this.recomputeBottomPad);
    
    // Subscribe to participant service updates
    this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
    });

    // Re-apply video effects on settings change
    window.addEventListener('settingschange', this.handleSettingsChange);
  }

  async ngOnDestroy() {
    window.removeEventListener('settingschange', this.handleSettingsChange);
    window.removeEventListener('resize', this.recomputeBottomPad);
    // Stop any ongoing video processing
    try { this.videoEffects.stop(); } catch {}
    await this.cleanup();
  }

  private async initializeMeeting() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    this.roomKey = `meeting-${this.meetingId}`;
    
    // Get current user info from token
    const token = localStorage.getItem('token') || '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      this.currentUserId = payload.sub;
      this.currentUserName = payload.name || payload.email || 'User';
      
      // Check if current user is the meeting host
      await this.checkHostStatus();
    } catch (error) {
      console.error('Error parsing token:', error);
      this.router.navigate(['/login']);
      return;
    }

    // Connect to SignalR first
    await this.signalr.start(token);
    this.connected = true;

    // Setup SignalR listeners after connection is established
    this.setupSignalRListeners();

    // Join room after listeners are set up
    await this.signalr.joinRoom(this.roomKey);

    // Request current meeting duration after connection is established
    this.signalr.invoke('GetMeetingDuration', this.roomKey);

    // Current user will be added via presence update from server
  }

  private addCurrentUserAsParticipant() {
    // Check if current user already exists
    const currentUserExists = this.participants.some(p => p.userId === this.currentUserId);
    if (currentUserExists) {
      return;
    }

    const currentUser: Participant = {
      connectionId: 'local',
      userId: this.currentUserId,
      name: this.currentUserName,
      isHost: this.isHost,
      isMuted: this.meetingState.isMuted,
      isVideoOn: this.meetingState.isVideoOn,
      isScreenSharing: this.meetingState.isScreenSharing,
      isWhiteboardEnabled: false
    };

    this.participants.push(currentUser);
  }

  private setupSignalRListeners() {
    // Meeting duration updates from backend
    this.signalr.on('meeting-duration', (duration: string) => {
      this.meetingDuration = duration;
      this.triggerChangeDetection();
    });

    // Listen for meeting ended event
    this.signalr.on('meeting-ended', () => {
      this.router.navigate(['/meetings']);
    });

    // Presence updates
    this.signalr.on<any>('presence', (participants) => {
      this.handlePresenceUpdate(participants);
    });

    // WebRTC signaling
    this.signalr.on<any>('webrtc-offer', async (payload) => {
      await this.handleOffer(payload);
    });

    this.signalr.on<any>('webrtc-answer', async (payload) => {
      await this.handleAnswer(payload);
    });

    this.signalr.on<any>('webrtc-ice', async (payload) => {
      await this.handleIceCandidate(payload);
    });

    // Meeting state updates
    this.signalr.on<any>('meeting-state-update', (state) => {
      this.handleMeetingStateUpdate(state);
    });

    // Permission grants
    this.signalr.on<any>('perm-granted', async (permission) => {
      await this.handlePermissionGrant(permission);
    });

    // Whiteboard events
    this.signalr.on<any>('whiteboard-draw', (data) => {
      // Handle whiteboard drawing
    });

    // Chat messages
    this.signalr.on<any>('chat-message', (message) => {
      // Handle chat messages
    });
  }

  private async initializeMedia() {
    try {
      // Load pre-join settings
      const cameraEnabled = localStorage.getItem('cameraEnabled') === 'true';
      const microphoneEnabled = localStorage.getItem('microphoneEnabled') === 'true';
      
      this.meetingState.isVideoOn = cameraEnabled;
      this.meetingState.isMuted = !microphoneEnabled;

      // Only try to get media if at least one is enabled
      if (cameraEnabled || microphoneEnabled) {
        await this.ensureLocalStream();
      } else {
        // Both camera and mic are disabled, user can join without media
        console.log('User joining without camera or microphone');
      }
    } catch (error) {
      console.error('Error initializing media:', error);
      // If media fails, continue without media - user can still participate
      this.meetingState.isVideoOn = false;
      this.meetingState.isMuted = true;
    }
  }

  private handleSettingsChange = async () => {
    try {
      if (!this.rawLocalStream || !this.meetingState.isVideoOn) return;
      const settings = this.settingsService.settings().videoBackground;
      const processed = await this.videoEffects.apply(this.rawLocalStream, settings);
      this.localStream = processed;
      
      this.attachLocalTrackListeners();
      this.triggerChangeDetection();
      
      const newTrack = this.localStream.getVideoTracks()[0];
      if (newTrack) {
        await this.swapLocalVideoTrack(newTrack);
      }
    } catch (err) {
      console.warn('Failed to apply video background settings:', err);
    }
  };

  private async ensureLocalStream() {
    try {
      // Clean up existing stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          track.stop();
        });
        this.localStream = undefined;
      }
      if (this.rawLocalStream) {
        this.rawLocalStream.getTracks().forEach(track => {
          track.stop();
        });
        this.rawLocalStream = undefined;
      }

      // Use current meeting state instead of localStorage
      const cameraEnabled = this.meetingState.isVideoOn;
      const microphoneEnabled = !this.meetingState.isMuted;
      
      // If both are disabled, enable audio by default
      const finalAudioEnabled = microphoneEnabled || (!cameraEnabled && !microphoneEnabled);
      
      const constraints: MediaStreamConstraints = {
        video: cameraEnabled,
        audio: finalAudioEnabled
      };

      // Add device preferences with error handling
      const preferredCamera = localStorage.getItem('preferredCamera');
      const preferredMicrophone = localStorage.getItem('preferredMicrophone');
      
      if (preferredCamera && cameraEnabled) {
        (constraints.video as any) = { deviceId: { exact: preferredCamera } };
      }
      if (preferredMicrophone && finalAudioEnabled) {
        (constraints.audio as any) = { deviceId: { exact: preferredMicrophone } };
      }

      const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Set track states based on current meeting state
      const videoTrack = rawStream.getVideoTracks()[0];
      const audioTrack = rawStream.getAudioTracks()[0];
      
      if (videoTrack) {
        videoTrack.enabled = cameraEnabled;
      }
      if (audioTrack) {
        audioTrack.enabled = microphoneEnabled;
      }

      // Cache raw
      this.rawLocalStream = rawStream;
      // Apply effects synchronously for first frame so local/remote see filtered without refresh
      if (cameraEnabled) {
        try {
          const vb = this.settingsService.settings().videoBackground;
          this.localStream = await this.videoEffects.apply(this.rawLocalStream, vb);
        } catch (e) {
          console.warn('Video effects failed, using raw stream:', e);
          this.localStream = this.rawLocalStream;
        }
      } else {
        this.localStream = this.rawLocalStream;
      }

      // Notify UI and attach listeners
      this.attachLocalTrackListeners();
      this.triggerChangeDetection();
      
      // Update peers (initial connection uses the chosen stream)
      await this.updateAllPeerConnections();
      await this.sendOffersToNewParticipants();
    } catch (error) {
      console.error('Error ensuring local stream:', error);
      // Fallback to audio-only if video fails
      if (this.meetingState.isVideoOn) {
        this.meetingState.isVideoOn = false;
        this.meetingState.isMuted = false;
        // Retry with audio only
        await this.ensureLocalStream();
      }
    }
  }

  private async updateAllPeerConnections() {
    // Batch renegotiation to avoid multiple simultaneous offers
    const renegotiationPromises: Promise<void>[] = [];

    this.peerConnections.forEach((pc, userId) => {
      // Check if connection is still valid
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }

      // Remove existing tracks
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          try {
            pc.removeTrack(sender);
          } catch (error) {
            console.warn('Error removing track:', error);
          }
        }
      });
      
      // Add new tracks if local stream exists
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            pc.addTrack(track, this.localStream!);
          } catch (error) {
            console.warn('Error adding track:', error);
          }
        });
      }
      
      // Queue renegotiation
      renegotiationPromises.push(this.renegotiateConnection(userId));
    });

    // Execute all renegotiations in parallel with error handling
    try {
      await Promise.allSettled(renegotiationPromises);
    } catch (error) {
      console.error('Error during batch renegotiation:', error);
    }
  }

  private async renegotiateConnection(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await this.signalr.sendToRoom(this.roomKey, 'webrtc-offer', {
        sdp: pc.localDescription,
        targetUserId: userId
      });
    } catch (error) {
      console.error('Error renegotiating connection:', error);
    }
  }

  private async sendOffersToNewParticipants() {
    if (!this.localStream) return;

    const connectionPromises = this.participants
      .filter(participant => 
        participant.userId !== this.currentUserId && 
        !this.peerConnections.has(participant.userId)
      )
      .map(async (participant) => {
        try {
          await this.createPeerConnection(participant.userId);
          await this.sendOffer(participant.userId);
        } catch (error) {
          console.error(`Error creating connection for ${participant.userId}:`, error);
        }
      });

    await Promise.allSettled(connectionPromises);
  }

  private updateParticipantStateFromTracks(userId: string, stream: MediaStream) {
    const participant = this.participants.find(p => p.userId === userId);
    if (!participant) return;

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    // Update participant state based on actual track states
    const isVideoOn = videoTrack ? videoTrack.enabled : false;
    const isMuted = audioTrack ? !audioTrack.enabled : true;
    const isScreenSharing = videoTrack && videoTrack.label.includes('screen');

    // Update via participant service
    this.participantService.updateParticipantState(userId, {
      isVideoOn,
      isMuted,
      isScreenSharing
    });
  }

  private handleTrackEnded(userId: string, track: MediaStreamTrack) {
    console.log(`Track ended for user ${userId}:`, track.kind);
    
    if (track.kind === 'video') {
      // Remove video track from stream and update state
      const stream = this.remoteStreams.get(userId);
      if (stream) {
        stream.removeTrack(track);
        
        // Update participant state to reflect video is off
        this.participantService.updateVideoState(userId, false);
        
        // If no video tracks left, remove the stream
        if (stream.getVideoTracks().length === 0) {
          this.remoteStreams.delete(userId);
        }
      }
    }
    
    this.triggerChangeDetection();
  }

  // Meeting controls
  async toggleMute() {
    if (this.isMuteToggling) return;
    
    this.isMuteToggling = true;
    
    try {
      this.meetingState.isMuted = !this.meetingState.isMuted;
      
      if (this.localStream && this.localStream.getAudioTracks()[0]) {
        this.localStream.getAudioTracks()[0].enabled = !this.meetingState.isMuted;
      } else if (!this.meetingState.isMuted) {
        // Try to get microphone access if not available
        try {
          await this.ensureLocalStream();
        } catch (error) {
          console.error('Failed to get microphone access:', error);
          this.meetingState.isMuted = true;
          return;
        }
      }

      // Update participant state via service
      this.participantService.updateMuteState(this.currentUserId, this.meetingState.isMuted);

      // Broadcast state change
      await this.broadcastStateChange();
      this.triggerChangeDetection();
    } catch (error) {
      console.error('Error toggling mute:', error);
    } finally {
      // Add small delay to prevent rapid clicking
      setTimeout(() => {
        this.isMuteToggling = false;
      }, 500);
    }
  }

  async toggleVideo() {
    if (this.isVideoToggling) return;
    
    this.isVideoToggling = true;
    
    try {
      this.meetingState.isVideoOn = !this.meetingState.isVideoOn;
      
      if (this.meetingState.isVideoOn) {
        // Turn on camera - ensure we have a video track
        if (!this.localStream || !this.localStream.getVideoTracks()[0]) {
          try {
            await this.ensureLocalStream();
          } catch (error) {
            console.error('Failed to get camera access:', error);
            this.meetingState.isVideoOn = false;
            return;
          }
        } else {
          // Enable existing video track
          const videoTrack = this.localStream.getVideoTracks()[0];
          videoTrack.enabled = true;
        }
      } else {
        // Turn off camera - stop the video track to turn off camera LED
        if (this.localStream && this.localStream.getVideoTracks()[0]) {
          const videoTrack = this.localStream.getVideoTracks()[0];
          videoTrack.stop(); // This will turn off the camera LED
          
          // Remove the track from the stream
          this.localStream.removeTrack(videoTrack);
          
          // Create a new stream without video for audio-only
          const audioTracks = this.localStream.getAudioTracks();
          if (audioTracks.length > 0) {
            const newStream = new MediaStream(audioTracks);
            this.localStream = newStream;
          }

          // Stop video effects processing when camera is off
          try { this.videoEffects.stop(); } catch {}
        }
      }

      // Notify UI and refresh listeners
      this.attachLocalTrackListeners();
      this.triggerChangeDetection();

      // Update participant state via service
      this.participantService.updateVideoState(this.currentUserId, this.meetingState.isVideoOn);

      // Update all peer connections with new stream
      this.updateAllPeerConnections();

      // Broadcast state change
      await this.broadcastStateChange();
      this.triggerChangeDetection();
    } catch (error) {
      console.error('Error toggling video:', error);
    } finally {
      // Add delay to prevent rapid clicking
      setTimeout(() => {
        this.isVideoToggling = false;
      }, 1000); // Video operations can take longer
    }
  }

  async toggleScreenShare() {
    if (this.isScreenShareToggling) return;
    
    this.isScreenShareToggling = true;
    
    try {
      if (this.meetingState.isScreenSharing) {
        await this.stopScreenShare();
      } else {
        await this.startScreenShare();
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
    } finally {
      // Add delay to prevent rapid clicking
      setTimeout(() => {
        this.isScreenShareToggling = false;
      }, 1500); // Screen share operations can take longer
    }
  }

  private async startScreenShare() {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: false
      });

      const screenTrack = stream.getVideoTracks()[0];
      
      // Replace video track in all peer connections
      this.peerConnections.forEach((pc, userId) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
      });

      this.meetingState.isScreenSharing = true;
      
      // Update participant state via service
      this.participantService.updateScreenShareState(this.currentUserId, true);

      // Handle screen share end
      screenTrack.onended = async () => {
        await this.stopScreenShare();
      };

      await this.broadcastStateChange();
      this.triggerChangeDetection();
    } catch (error) {
      console.error('Error starting screen share:', error);
    }
  }

  private async stopScreenShare() {
    this.meetingState.isScreenSharing = false;
    
    // Update participant state via service
    this.participantService.updateScreenShareState(this.currentUserId, false);

    // Restore camera track
    if (this.localStream) {
      const cameraTrack = this.localStream.getVideoTracks()[0];
      if (cameraTrack) {
        this.peerConnections.forEach((pc, userId) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(cameraTrack);
          }
        });
      }
    }

    await this.broadcastStateChange();
    this.triggerChangeDetection();
  }

  // UI controls
  toggleParticipantsPanel() {
    this.showParticipantsPanel = !this.showParticipantsPanel;
  }

  toggleChatPanel() {
    this.showChatPanel = !this.showChatPanel;
  }

  toggleWhiteboardPanel() {
    this.showWhiteboardPanel = !this.showWhiteboardPanel;
    this.meetingState.isWhiteboardActive = this.showWhiteboardPanel;
    
    if (this.showWhiteboardPanel) {
      this.activeView = 'whiteboard';
    } else {
      this.activeView = 'grid';
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      this.isFullscreen = true;
    } else {
      document.exitFullscreen();
      this.isFullscreen = false;
    }
  }

  setActiveView(view: 'grid' | 'speaker' | 'whiteboard') {
    this.activeView = view;
    if (view === 'whiteboard') {
      this.showWhiteboardPanel = true;
      this.meetingState.isWhiteboardActive = true;
    } else {
      this.showWhiteboardPanel = false;
      this.meetingState.isWhiteboardActive = false;
    }
  }

  // Permission management (host only)
  async grantPermission(userId: string, permission: string) {
    if (!this.isHost) return;
    
    await this.signalr.sendToRoom(this.roomKey, 'grant-permission', {
      targetUserId: userId,
      permission
    });
  }

  async removeParticipant(userId: string) {
    if (!this.isHost) return;
    
    await this.signalr.sendToRoom(this.roomKey, 'remove-participant', {
      targetUserId: userId
    });
  }

  // WebRTC methods
  private async handlePresenceUpdate(participants: any[]) {
    // Update participants list and ensure all participants have required properties
    const updatedParticipants = participants.map(p => ({
      ...p,
      isVideoOn: p.isVideoOn ?? false,
      isMuted: p.isMuted ?? false,
      isScreenSharing: p.isScreenSharing ?? false,
      isWhiteboardEnabled: p.isWhiteboardEnabled ?? false,
      isHost: p.userId === this.currentUserId ? this.isHost : false
    }));
    
    // Update participant service
    this.participantService.setParticipants(updatedParticipants);
    this.participants = updatedParticipants;
    
    // Ensure current user is in the list (only if not already present)
    const currentUserExists = this.participants.some(p => p.userId === this.currentUserId);
    if (!currentUserExists) {
      this.addCurrentUserAsParticipant();
    }

    // Batch peer connection creation for new participants
    const newParticipants = this.participants.filter(p => 
      p.userId !== this.currentUserId && !this.peerConnections.has(p.userId)
    );

    if (newParticipants.length > 0) {
      const connectionPromises = newParticipants.map(async (participant) => {
        await this.createPeerConnection(participant.userId);
        
        // Send offer immediately if we have local stream
        if (this.localStream) {
        await this.sendOffer(participant.userId);
      }
      });

      // Execute all connections in parallel
      Promise.all(connectionPromises).catch(error => {
        console.error('Error creating peer connections:', error);
      });
    }

    // Remove connections for participants who left
    const currentParticipantIds = new Set(this.participants.map(p => p.userId));
    for (const [userId, pc] of this.peerConnections) {
      if (!currentParticipantIds.has(userId)) {
        pc.close();
        this.peerConnections.delete(userId);
        this.remoteStreams.delete(userId);
        this.pendingIceCandidates.delete(userId);
      }
    }
    
    this.triggerChangeDetection();
  }

  private async createPeerConnection(userId: string) {
    const pc = new RTCPeerConnection({ 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalr.sendToRoom(this.roomKey, 'webrtc-ice', { 
          candidate: event.candidate, 
          targetUserId: userId 
        })?.catch(error => {
          console.error('Error sending ICE candidate:', error);
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${userId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Clean up failed connections
        this.cleanupPeerConnection(userId);
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      this.remoteStreams.set(userId, stream);
      
      // Update participant state based on received tracks
      this.updateParticipantStateFromTracks(userId, stream);
      
      // Add track event listeners for cleanup
      event.track.onended = () => {
        this.handleTrackEnded(userId, event.track);
      };
      // Reflect mute/unmute on UI
      (event.track as any).onmute = () => {
        this.zone.run(() => {
          this.updateParticipantStateFromTracks(userId, stream);
          this.triggerChangeDetection();
        });
      };
      (event.track as any).onunmute = () => {
        this.zone.run(() => {
          this.updateParticipantStateFromTracks(userId, stream);
          this.triggerChangeDetection();
        });
      };
      
      this.triggerChangeDetection();
    };

    this.peerConnections.set(userId, pc);
    return pc;
  }

  private async sendOffer(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    await this.signalr.sendToRoom(this.roomKey, 'webrtc-offer', { 
      sdp: pc.localDescription, 
      targetUserId: userId 
    });
  }

  private async handleOffer(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { sdp, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    let pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      pc = await this.createPeerConnection(fromUserId);
    }

    try {
      // Check if peer connection is still in a valid state
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }

      // Check if we already have a remote description
      if (pc.remoteDescription) {
        return;
      }

      // Check if we're in the right state to handle offer
      if (pc.signalingState !== 'stable') {
        return;
      }

      // Add local tracks to the peer connection
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream!);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // Process pending ICE candidates
      await this.processPendingIceCandidates(fromUserId);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await this.signalr.sendToRoom(this.roomKey, 'webrtc-answer', { 
        sdp: pc.localDescription, 
        targetUserId: fromUserId 
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  private async handleAnswer(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { sdp, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      return;
    }

    try {
      // Check if peer connection is still in a valid state
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }

      // Check if we already have a remote description
      if (pc.remoteDescription) {
        return;
      }

      // Check if local description is set (required for answer)
      if (!pc.localDescription) {
        return;
      }

      // Check if we're in the right state to set remote description
      if (pc.signalingState !== 'have-local-offer') {
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // Process pending ICE candidates
      await this.processPendingIceCandidates(fromUserId);
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }

  private async handleIceCandidate(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { candidate, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      return;
    }

    if (candidate) {
      try {
      // Check if peer connection is still in a valid state
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }

      // Check if remote description is set before adding ICE candidate
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        // Store candidate for later when remote description is set
        if (!this.pendingIceCandidates.has(fromUserId)) {
          this.pendingIceCandidates.set(fromUserId, []);
        }
        this.pendingIceCandidates.get(fromUserId)!.push(new RTCIceCandidate(candidate));
      }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    }
  }

  private async handleMeetingStateUpdate(state: any) {
    // Update participant state from received state via service
    // Handle both direct state and nested state structures
    const stateData = state.state || state;
    
    this.participantService.updateParticipantState(state.userId, {
      isVideoOn: stateData.isVideoOn ?? false,
      isMuted: stateData.isMuted ?? false,
      isScreenSharing: stateData.isScreenSharing ?? false,
      isWhiteboardEnabled: stateData.isWhiteboardEnabled ?? false
    });
    
    this.triggerChangeDetection();
  }

  private async handlePermissionGrant(permission: any) {
    if (permission.targetUserId !== this.currentUserId) return;

    switch (permission.permission) {
      case 'mute':
        await this.toggleMute();
        break;
      case 'video':
        await this.toggleVideo();
        break;
      case 'screen':
        await this.toggleScreenShare();
        break;
      case 'whiteboard':
        this.toggleWhiteboardPanel();
        break;
    }
  }

  private async broadcastStateChange() {
    await this.signalr.sendToRoom(this.roomKey, 'meeting-state-update', {
      userId: this.currentUserId,
      state: this.meetingState
    });
  }

  // Utility methods
  getVideoParticipants() {
    return this.participants;
  }

  getVideoGridClass() {
    const totalParticipants = this.getVideoParticipants().length;
    
    if (totalParticipants <= 1) return 'grid-cols-1';
    if (totalParticipants <= 2) return 'grid-cols-2';
    if (totalParticipants <= 4) return 'grid-cols-2';
    if (totalParticipants <= 6) return 'grid-cols-3';
    if (totalParticipants <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  }

  async endMeeting() {
    try {
      // Notify backend to end the meeting (only if host)
      if (this.isHost) {
        await this.signalr.invoke('EndMeeting', this.roomKey);
      }
      await this.signalr.leaveRoom(this.roomKey);
      await this.cleanup();
      this.router.navigate(['/meetings']);
    } catch (error) {
      console.error('Error ending meeting:', error);
      this.router.navigate(['/meetings']);
    }
  }

  private async cleanup() {
    try {
      // Clear change detection timeout
      if (this.changeDetectionTimeout) {
        clearTimeout(this.changeDetectionTimeout);
        this.changeDetectionTimeout = null;
      }

      // Close all peer connections
      this.peerConnections.forEach((pc, userId) => {
        try {
          pc.close();
        } catch (error) {
          console.warn(`Error closing peer connection for ${userId}:`, error);
        }
      });
      this.peerConnections.clear();
      this.remoteStreams.clear();
      this.pendingIceCandidates.clear();
      
      // Stop local media tracks to turn off camera LED
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            track.stop(); // This will turn off camera LED
          } catch (error) {
            console.warn('Error stopping track:', error);
          }
        });
        this.localStream = undefined;
      }
      if (this.rawLocalStream) {
        this.rawLocalStream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
        this.rawLocalStream = undefined;
      }

      // Clear video elements
      if (this.localVideo?.nativeElement) {
        this.localVideo.nativeElement.srcObject = null;
      }
      if (this.remoteVideo?.nativeElement) {
        this.remoteVideo.nativeElement.srcObject = null;
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  private cleanupPeerConnection(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      try {
        pc.close();
      } catch (error) {
        console.warn(`Error closing peer connection for ${userId}:`, error);
      }
    }
    this.peerConnections.delete(userId);
    this.remoteStreams.delete(userId);
    this.pendingIceCandidates.delete(userId);
  }

  private changeDetectionTimeout: any = null;
  private readonly changeDetectionDelay = 16; // ~60fps

  triggerChangeDetection() {
    // Use setTimeout to avoid excessive change detection cycles
    if (!this.changeDetectionTimeout) {
      this.changeDetectionTimeout = setTimeout(() => {
        this.cdr.detectChanges();
        this.changeDetectionTimeout = null;
        // Recalculate padding when UI changes
        this.recomputeBottomPad();
      }, this.changeDetectionDelay);
    }
  }

  private async processPendingIceCandidates(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    const pendingCandidates = this.pendingIceCandidates.get(userId);
    if (pendingCandidates && pendingCandidates.length > 0) {
      for (const candidate of pendingCandidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.error('Error adding pending ICE candidate:', error);
        }
      }
      
      // Clear processed candidates
      this.pendingIceCandidates.delete(userId);
    }
  }

  private async checkHostStatus() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        this.isHost = false;
        return;
      }

      const base = (window as any).APP_API_BASE || (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || 'http://localhost:5125';
      const response = await fetch(`${base}/api/meetings/${this.meetingId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const meeting = await response.json();
        this.isHost = meeting.creatorId === this.currentUserId;
      } else {
        console.warn('Failed to check host status:', response.status);
        this.isHost = false;
      }
    } catch (error) {
      console.error('Error checking host status:', error);
      this.isHost = false;
    }
  }

  private async swapLocalVideoTrack(newTrack: MediaStreamTrack) {
    try {
      for (const [, pc] of this.peerConnections) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newTrack);
        } else {
          try {
            pc.addTrack(newTrack, this.localStream!);
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Error swapping local video track:', err);
    }
  }

  // Dynamic bottom padding based on controls bar height
  contentBottomPadPx = 128; // sensible default
  recomputeBottomPad = () => {
    try {
      const bar = this.controlsBar?.nativeElement;
      if (!bar) return;
      const h = bar.offsetHeight || 0;
      // add small gap
      this.contentBottomPadPx = Math.max(96, h + 24);
    } catch {}
  };

  // Manage local video element binding and playback when available in child templates
  private updateLocalVideoElement(show: boolean) {
    if (!this.localVideo?.nativeElement) return;
    const el = this.localVideo.nativeElement;
    el.style.display = show ? 'block' : 'none';
    if (show && this.localStream) {
      el.srcObject = this.localStream;
      el.muted = true;
      (el as any).playsInline = true;
      el.autoplay = true;
      try { el.play(); } catch {}
    } else {
      el.srcObject = null;
    }
  }

  // Attach listeners to reflect local video track state into Angular
  private currentLocalVideoTrack?: MediaStreamTrack;
  private attachLocalTrackListeners() {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) {
      this.currentLocalVideoTrack = undefined;
      return;
    }
    if (this.currentLocalVideoTrack === track) return;

    if (this.currentLocalVideoTrack) {
      try {
        (this.currentLocalVideoTrack as any).onmute = null;
        (this.currentLocalVideoTrack as any).onunmute = null;
        (this.currentLocalVideoTrack as any).onended = null;
      } catch {}
    }

    this.currentLocalVideoTrack = track;
    (track as any).onmute = () => {
      this.zone.run(() => {
        this.meetingState.isVideoOn = false;
        this.participantService.updateVideoState(this.currentUserId, false);
        this.triggerChangeDetection();
      });
    };
    (track as any).onunmute = () => {
      this.zone.run(() => {
        this.meetingState.isVideoOn = true;
        this.participantService.updateVideoState(this.currentUserId, true);
        this.triggerChangeDetection();
      });
    };
    (track as any).onended = () => {
      this.zone.run(() => {
        this.meetingState.isVideoOn = false;
        this.participantService.updateVideoState(this.currentUserId, false);
        this.triggerChangeDetection();
      });
    };
  }

}
