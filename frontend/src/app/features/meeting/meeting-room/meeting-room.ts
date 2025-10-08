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
import { ToastService } from '../../../core/services/toast.service';
import { SettingsService } from '../../../core/services/settings.service';
import { AppConfigService } from '../../../core/services/app-config.service';

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
  // Cache transceivers per peer to keep stable m-line ordering
  private peerAudioTransceiver: Map<string, RTCRtpTransceiver> = new Map();
  private peerVideoTransceiver: Map<string, RTCRtpTransceiver> = new Map();
  pendingIceCandidates: Map<string, RTCIceCandidate[]> = new Map();
  // Perfect negotiation state per peer
  private makingOffer: Map<string, boolean> = new Map();
  private politeMap: Map<string, boolean> = new Map();

  // Active speaker detection
  private audioContext?: AudioContext;
  private audioSources: Map<string, MediaStreamAudioSourceNode> = new Map();
  private analyserNodes: Map<string, AnalyserNode> = new Map();
  private speakingVolumes: Map<string, number> = new Map();
  private activeSpeakerAnimationFrame: number | null = null;
  private wasVideoOnBeforeShare = false;

  // UI state
  showParticipantsPanel = false;
  showChatPanel = false;
  showWhiteboardPanel = false;
  isFullscreen = false;
  activeView: 'grid' | 'speaker' | 'whiteboard' = 'speaker'; // Default to speaker view for testing

  // Control states to prevent rapid clicking
  isVideoToggling = false;
  isScreenShareToggling = false;
  isMuteToggling = false;

  // Meeting duration tracking
  meetingDuration = '00:00:00';
  // Negotiation debounce
  private negotiationTimers: Map<string, any> = new Map();
  private readonly negotiationDebounceMs = 350;

  // ViewChild references
  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo', { static: true }) remoteVideo!: ElementRef<HTMLVideoElement>;

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    public signalr: SignalRService,
    private participantService: ParticipantService,
    private cdr: ChangeDetectorRef,
    private videoEffects: VideoEffectsService,
    private settingsService: SettingsService,
    private zone: NgZone,
    private toast: ToastService,
    private cfg: AppConfigService
  ) {}

  async ngOnInit() {
    // Preload segmentation to reduce first-frame latency
    try { await this.videoEffects.preload(); } catch {}
    // Ensure local media first so initial offer contains stable m-lines
    await this.initializeMedia();
    // Then connect signaling and join room
    await this.initializeMeeting();
    
    // Subscribe to participant service updates
    this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
    });

    // Re-apply video effects on settings change
    window.addEventListener('settingschange', this.handleSettingsChange);

    // Start active speaker loop (will take effect when analysers exist)
    this.startActiveSpeakerLoop();

    // Restore default view preference
    try {
      const saved = localStorage.getItem('meeting.defaultView');
      if (saved === 'grid' || saved === 'speaker' || saved === 'whiteboard') {
        this.setActiveView(saved as any);
      }
    } catch {}
  }

  async ngOnDestroy() {
    window.removeEventListener('settingschange', this.handleSettingsChange);
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

    // ICE candidates enabled for better connectivity
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
      this.toast.error('Kamera/Mikrofon başlatılamadı. Ayarlarınızı kontrol edin.');
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
      
      // Setup active speaker analysis for local user's audio
      try {
        this.removeAudioAnalysis(this.currentUserId);
        if (this.localStream) {
          this.setupAudioAnalysisForStream(this.currentUserId, this.localStream);
        }
      } catch {}
      
      // Update peers (initial connection uses the chosen stream)
      await this.updateAllPeerConnections();
      await this.sendOffersToNewParticipants();
    } catch (error) {
      this.toast.error('Yerel medya alınamadı. Mikrofon/kamera izni gerekli olabilir.');
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
    console.log(`🔄 Updating all peer connections:`, {
      totalConnections: this.peerConnections.size,
      hasLocalStream: !!this.localStream,
      meetingState: this.meetingState
    });

    // Batch renegotiation to avoid multiple simultaneous offers
    const replacePromises: Promise<void>[] = [];

    this.peerConnections.forEach((pc, userId) => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        console.log(`⏭️ Skipping ${userId} - connection state: ${pc.connectionState}`);
        return;
      }
      console.log(`🔄 Updating peer connection for ${userId}`);
      // Use transceivers to keep m-lines stable
      const audioTx = this.peerAudioTransceiver.get(userId);
      const videoTx = this.peerVideoTransceiver.get(userId);
      const localVideo = this.localStream?.getVideoTracks()[0] || null;
      const localAudio = this.localStream?.getAudioTracks()[0] || null;
      if (audioTx) {
        const target = !this.meetingState.isMuted ? localAudio : null;
        replacePromises.push(audioTx.sender.replaceTrack(target as any).catch(() => {}));
      }
      if (videoTx) {
        // If screen sharing is active and there is no local camera track, keep the existing sender track (screen)
        if (this.meetingState.isScreenSharing && !localVideo) {
          // no-op: preserve current screen share track on sender
        } else {
          const target = (this.meetingState.isVideoOn || this.meetingState.isScreenSharing) ? localVideo : null;
          replacePromises.push(videoTx.sender.replaceTrack(target as any).catch(() => {}));
        }
      }
    });

    // Execute all renegotiations in parallel with error handling
    try {
      await Promise.allSettled(replacePromises);
      console.log(`✅ All peer connection senders updated successfully`);
    } catch (error) {
      console.error('Error during sender replacement:', error);
    }
  }

  // Removed explicit renegotiation; using onnegotiationneeded

  private async sendOffersToNewParticipants() {
    // No-op: onnegotiationneeded will handle offers once PC/transceivers are set up
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
    
    if (track.kind === 'audio') {
      // Remove audio analysis nodes when remote audio ends
      this.removeAudioAnalysis(userId);
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
      this.toast.error('Mikrofon izni reddedildi veya kullanılamıyor.');
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
            // After obtaining a fresh local stream, proactively swap the video track on all senders
            const newTrack = this.localStream?.getVideoTracks()[0];
            if (newTrack) {
              await this.swapLocalVideoTrack(newTrack);
            }
          } catch (error) {
      this.toast.error('Kamera izni reddedildi veya kullanılamıyor.');
            this.meetingState.isVideoOn = false;
            return;
          }
        } else {
          // Enable existing video track
          const videoTrack = this.localStream.getVideoTracks()[0];
          videoTrack.enabled = true;
          try {
            await this.swapLocalVideoTrack(videoTrack);
          } catch {}
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
      await this.updateAllPeerConnections();

      // Broadcast state change
      await this.broadcastStateChange();
      this.triggerChangeDetection();
    } catch (error) {
      this.toast.error('Kamera değiştirilemedi. Lütfen tekrar deneyin.');
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
      this.toast.error('Ekran paylaşımı başlatılamadı. Tarayıcı izinlerini kontrol edin.');
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
      
      console.log(`🖥️ Starting screen share:`, {
        screenTrackId: screenTrack.id,
        screenTrackEnabled: screenTrack.enabled,
        peerConnectionsCount: this.peerConnections.size
      });
      
      // Replace video track using transceivers to keep m-line order stable
      this.peerConnections.forEach((pc, userId) => {
        const videoTx = this.peerVideoTransceiver.get(userId);
        if (videoTx) {
          videoTx.sender.replaceTrack(screenTrack).catch(() => {});
          console.log(`🔄 Replaced video track for ${userId} with screen share`);
        }
      });

      // Remember current camera state and turn camera off while sharing for performance
      this.wasVideoOnBeforeShare = this.meetingState.isVideoOn;
      this.meetingState.isVideoOn = false;
      // Stop and remove local camera track if exists
      if (this.localStream && this.localStream.getVideoTracks()[0]) {
        try {
          const cam = this.localStream.getVideoTracks()[0];
          cam.stop();
          this.localStream.removeTrack(cam);
        } catch {}
      }

      this.meetingState.isScreenSharing = true;
      
      // Update participant state via service
      this.participantService.updateScreenShareState(this.currentUserId, true);

      // Handle screen share end
      screenTrack.onended = async () => {
        console.log(`🖥️ Screen share ended by user`);
        await this.stopScreenShare();
      };

      await this.broadcastStateChange();
      this.triggerChangeDetection();
    } catch (error) {
      this.toast.error('Ekran paylaşımı başlatılamadı.');
    }
  }

  private async stopScreenShare() {
    console.log(`🖥️ Stopping screen share`);
    
    this.meetingState.isScreenSharing = false;
    
    // Update participant state via service
    this.participantService.updateScreenShareState(this.currentUserId, false);

    // Restore camera track using transceivers
    this.peerConnections.forEach((pc, userId) => {
      const videoTx = this.peerVideoTransceiver.get(userId);
      if (!videoTx) return;
      if (this.localStream && (this.meetingState.isVideoOn || this.wasVideoOnBeforeShare)) {
        const cameraTrack = this.localStream.getVideoTracks()[0] || null;
        videoTx.sender.replaceTrack(cameraTrack as any).catch(() => {});
        console.log(`🔄 Restored camera track for ${userId}`);
      } else {
        // Keep m-line stable; send null to stop video
        videoTx.sender.replaceTrack(null as any).catch(() => {});
        console.log(`🗑️ Stopped video for ${userId} (camera off)`);
      }
    });

    // Restore meetingState video flag to pre-share state
    if (this.wasVideoOnBeforeShare) {
      this.meetingState.isVideoOn = true;
      // If local camera track missing, try to reacquire video
      if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
        try { await this.toggleVideo(); } catch {}
      }
    }
    this.wasVideoOnBeforeShare = false;

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

    // Persist preference
    try { localStorage.setItem('meeting.defaultView', view); } catch {}
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
        // Attach local tracks; onnegotiationneeded will create an offer
        const pc = this.peerConnections.get(participant.userId);
        if (pc) {
          this.applyLocalTracksToPc(pc);
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
        this.peerAudioTransceiver.delete(userId);
        this.peerVideoTransceiver.delete(userId);
      }
    }
    
    this.triggerChangeDetection();
  }

  private async createPeerConnection(userId: string) {
    const configuration = { 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
    const pc = new RTCPeerConnection(configuration);

    // Determine polite role deterministically to avoid glare
    const polite = this.currentUserId < userId;
    this.politeMap.set(userId, polite);

    // Pre-create transceivers to stabilize m-line order and cache them
    try {
      const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
      this.peerAudioTransceiver.set(userId, audioTx);
      this.peerVideoTransceiver.set(userId, videoTx);
    } catch {}

    // Enable ICE candidate signaling for better connectivity
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`ICE candidate generated for ${userId}:`, event.candidate);
        // Store candidate locally
        if (!this.pendingIceCandidates.has(userId)) {
          this.pendingIceCandidates.set(userId, []);
        }
        this.pendingIceCandidates.get(userId)!.push(event.candidate);
        // Send candidate to remote peer via signaling (trickle ICE)
        try {
          this.signalr.sendToRoom(this.roomKey, 'webrtc-ice', {
            candidate: event.candidate,
            targetUserId: userId
          });
        } catch (err) {
          console.warn('Failed to send ICE candidate:', err);
        }
      } else {
        console.log(`ICE candidate gathering completed for ${userId}`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${userId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Clean up failed connections
        this.cleanupPeerConnection(userId);
      }
    };

    // Perfect negotiation with debounce to avoid glare
    const scheduleNegotiation = (uid: string) => {
      const timer = this.negotiationTimers.get(uid);
      if (timer) return;
      const handle = setTimeout(async () => {
        this.negotiationTimers.delete(uid);
        try {
          if (this.makingOffer.get(uid)) return;
          if (pc.signalingState !== 'stable') return;
          this.makingOffer.set(uid, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await this.signalr.sendToRoom(this.roomKey, 'webrtc-offer', {
            sdp: pc.localDescription,
            targetUserId: uid
          });
        } catch (err) {
          console.error('onnegotiationneeded error:', err);
        } finally {
          this.makingOffer.set(uid, false);
        }
      }, this.negotiationDebounceMs);
      this.negotiationTimers.set(uid, handle);
    };

    pc.onnegotiationneeded = () => scheduleNegotiation(userId);

    pc.ontrack = (event) => {
      this.zone.run(() => {
      console.log(`🎯 ONTRACK event received from ${userId}:`, {
        trackKind: event.track.kind,
        trackEnabled: event.track.enabled,
        trackMuted: event.track.muted,
        trackReadyState: event.track.readyState,
        streamId: event.streams[0]?.id,
        streamVideoTracks: event.streams[0]?.getVideoTracks().length || 0,
        streamAudioTracks: event.streams[0]?.getAudioTracks().length || 0
      });
      
      let [incomingStream] = event.streams;
      // Some browsers may fire ontrack with empty streams when using transceivers/replaceTrack
      if (!incomingStream) {
        const existingOrNew = this.remoteStreams.get(userId) || new MediaStream();
        try {
          // Avoid duplicate tracks
          const dup = existingOrNew.getTracks().some(t => t.id === event.track.id);
          if (!dup) {
            existingOrNew.addTrack(event.track);
          }
        } catch {}
        this.remoteStreams.set(userId, existingOrNew);
        incomingStream = existingOrNew;
      }

      // Prevent duplicate stream/track additions
      const existing = this.remoteStreams.get(userId);
      if (existing) {
        const duplicate = existing.getTracks().some(t => t.id === event.track.id);
        if (duplicate) {
          console.log(`↩️ Duplicate track ignored for ${userId}: ${event.track.id}`);
          return;
        }
      }

      // Use incoming stream if first time; otherwise keep a single video track
      if (!existing) {
        this.remoteStreams.set(userId, incomingStream);
      } else {
        if (event.track.kind === 'video') {
          try {
            existing.getVideoTracks().forEach(t => existing.removeTrack(t));
          } catch {}
        }
        try { existing.addTrack(event.track); } catch {}
      }
      
      console.log(`✅ Remote ${event.track.kind} track added for ${userId}, total streams: ${this.remoteStreams.size}`);
      
      // Update participant state based on received tracks
      const streamToUse = this.remoteStreams.get(userId)!;
      this.updateParticipantStateFromTracks(userId, streamToUse);
      
      // Add track event listeners for cleanup
      event.track.onended = () => {
        console.log(`📺 Track ended for ${userId}: ${event.track.kind}`);
        this.handleTrackEnded(userId, event.track);
      };
      
      // Reflect mute/unmute on UI
      (event.track as any).onmute = () => {
        console.log(`🔇 Track muted for ${userId}: ${event.track.kind}`);
        this.zone.run(() => {
          const latest = this.remoteStreams.get(userId) || incomingStream;
          this.updateParticipantStateFromTracks(userId, latest);
          this.triggerChangeDetection();
        });
      };
      
      (event.track as any).onunmute = () => {
        console.log(`🔊 Track unmuted for ${userId}: ${event.track.kind}`);
        this.zone.run(() => {
          const latest = this.remoteStreams.get(userId) || incomingStream;
          this.updateParticipantStateFromTracks(userId, latest);
          this.triggerChangeDetection();
        });
      };
      
      // Force immediate change detection for video tracks
      if (event.track.kind === 'video') {
        this.cdr.detectChanges();
      }
      
      // Setup audio analyser for active speaker detection on remote audio
      if (event.track.kind === 'audio') {
        try {
          const [incomingStream] = event.streams;
          if (incomingStream) {
            this.setupAudioAnalysisForStream(userId, incomingStream);
          }
        } catch {}
      }
      
      this.triggerChangeDetection();
      });
    };

    this.peerConnections.set(userId, pc);
    console.log(`🚀 Peer Connection created for ${userId}, total connections: ${this.peerConnections.size}`);
    // Apply local tracks if available; onnegotiationneeded will send offer
    this.applyLocalTracksToPc(pc);
    return pc;
  }

  private applyLocalTracksToPc(pc: RTCPeerConnection) {
    if (!pc) return;
    const entry = Array.from(this.peerConnections.entries()).find(([, val]) => val === pc);
    const userId = entry?.[0];
    if (!userId) return;

    const audioTx = this.peerAudioTransceiver.get(userId);
    const videoTx = this.peerVideoTransceiver.get(userId);

    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const videoTrack = this.localStream?.getVideoTracks()[0] || null;

    try {
      if (audioTx) {
        const shouldSendAudio = !!audioTrack && !this.meetingState.isMuted;
        audioTx.direction = 'sendrecv';
        audioTx.sender.replaceTrack(shouldSendAudio ? audioTrack : null as any).catch(() => {});
      }
      if (videoTx) {
        const shouldSendVideo = !!videoTrack && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing);
        videoTx.direction = 'sendrecv';
        videoTx.sender.replaceTrack(shouldSendVideo ? videoTrack : null as any).catch(() => {});
      }
    } catch (err) {
      console.warn('applyLocalTracksToPc error:', err);
    }
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
      const polite = this.politeMap.get(fromUserId) ?? true;
      const offerCollision = pc.signalingState !== 'stable';
      if (offerCollision) {
        if (!polite) {
          console.log('Ignoring offer due to collision (impolite)');
          return;
        }
        try { await pc.setLocalDescription({ type: 'rollback' } as any); } catch {}
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
      // Self-heal on SDP/m-line issues: recreate peer connection cleanly
      const isSdpOrderError = (error as any)?.message?.includes('m-lines') || (error as any)?.message?.includes('order');
      if (isSdpOrderError) {
        try {
          this.cleanupPeerConnection(fromUserId);
          const newPc = await this.createPeerConnection(fromUserId);
          if (newPc) {
            // Apply local tracks; negotiation will trigger
            this.applyLocalTracksToPc(newPc);
          }
        } catch (e) {
          console.warn('Failed to self-heal by recreating PC:', e);
        }
      }
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
      if (pc.signalingState !== 'have-local-offer') {
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // Process pending ICE candidates
      await this.processPendingIceCandidates(fromUserId);
    } catch (error) {
      console.error('Error handling answer:', error);
      // Self-heal on SDP/m-line issues
      const isSdpOrderError = (error as any)?.message?.includes('m-lines') || (error as any)?.message?.includes('order');
      if (isSdpOrderError) {
        try {
          this.cleanupPeerConnection(fromUserId);
          const newPc = await this.createPeerConnection(fromUserId);
          if (newPc) {
            this.applyLocalTracksToPc(newPc);
          }
        } catch (e) {
          console.warn('Failed to self-heal by recreating PC (answer):', e);
        }
      }
    }
  }

  private async handleIceCandidate(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { candidate, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      console.log(`No peer connection found for ${fromUserId} when handling ICE candidate`);
      return;
    }

    if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
        console.log(`ICE candidate added successfully from ${fromUserId}`);
      } catch (error) {
        console.warn(`Failed to add ICE candidate from ${fromUserId}:`, error);
        // If ICE fails repeatedly, attempt restart once
        try { pc.restartIce(); } catch {}
      }
    }
  }

  private async handleMeetingStateUpdate(state: any) {
    // Extract userId from various possible formats
    let userId = state.userId || state.userId || state.fromUserId || state.user;
    
    // If still no userId, try to extract from signalr context
    if (!userId) {
      // UserId might be embedded in the data differently
      userId = state.senderId || state.senderUser || state.userGuid || state.fromUserId;
    }
    
    const stateData = state.state || state;
    
    console.log(`🎬 MeetingRoom: Video state update for user ${userId}:`, {
      isVideoOn: stateData.isVideoOn,
      isMuted: stateData.isMuted,
      isScreenSharing: stateData.isScreenSharing,
      hasRemoteStream: this.remoteStreams.has(userId),
      remoteStreamTracks: this.remoteStreams.get(userId)?.getVideoTracks().length || 0,
      peerConnectionsSize: this.peerConnections.size,
      remoteStreamsSize: this.remoteStreams.size
    });
    
    // If we still don't have userId, ignore this update
    if (!userId) {
      console.warn(`🎬 MeetingRoom: Ignoring meeting state update - no userId found`);
      return;
    }
    
    // Prefer actual track presence over broadcast flags for remote users
    const remoteStream = this.remoteStreams.get(userId);
    const hasVideoTrack = !!remoteStream && remoteStream.getVideoTracks().length > 0;
    // Use strict track presence for isVideoOn to avoid stale flags keeping video visible
    const computedIsVideoOn = hasVideoTrack;
    console.log(`🎬 MeetingRoom: Computed video state for ${userId}:`, {
      rawIsVideoOn: stateData.isVideoOn,
      computedIsVideoOn
    });
    this.participantService.updateParticipantState(userId, {
      isVideoOn: computedIsVideoOn,
      isMuted: stateData.isMuted ?? false,
      isScreenSharing: stateData.isScreenSharing ?? false,
      isWhiteboardEnabled: stateData.isWhiteboardEnabled ?? false
    });
    
    // Force immediate change detection for UI updates
    this.cdr.detectChanges();
    
    // If current user's video state changed, trigger peer connection updates
    if (userId === this.currentUserId) {
      console.log(`🎬 MeetingRoom: Current user ${this.currentUserId} state changed - refreshing video elements`);
      // Force video elements to refresh with new stream
      this.refreshVideoElements();
    }
    
    // Additional change detection for video components
    setTimeout(() => {
      this.triggerChangeDetection();
    }, 50);
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
    try {
      // Use the proper SignalR hub method to ensure userId is included
      await this.signalr.invoke('BroadcastMeetingStateUpdate', this.roomKey, {
        isVideoOn: this.meetingState.isVideoOn,
        isMuted: this.meetingState.isMuted,
        isScreenSharing: this.meetingState.isScreenSharing,
        isWhiteboardActive: this.meetingState.isWhiteboardActive
      });
      
      console.log('📡 State broadcasted:', {
        isVideoOn: this.meetingState.isVideoOn,
        isMuted: this.meetingState.isMuted,
        isScreenSharing: this.meetingState.isScreenSharing
      });
    } catch (error) {
      console.error('❌ Failed to broadcast state change:', error);
    }
  }

  private   refreshVideoElements() {
    // Refresh local video element
    if (this.localVideo && this.localStream) {
      this.localVideo.nativeElement.srcObject = this.localStream;
    }

    // Force Angular change detection to update all video components
    this.triggerChangeDetection();

    // Update peer connections to ensure remote sides get updated streams
    this.updateAllPeerConnections();
  }

  // Track processed ICE candidates to avoid duplicates
  private processedIceCandidates = new Set<string>();

  private generateIceCandidateId(candidate: any): string {
    return `${candidate.sdpMid || ''}_${candidate.candidate || ''}_${candidate.sdpMLineIndex || ''}`;
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
      this.peerAudioTransceiver.clear();
      this.peerVideoTransceiver.clear();
      
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
      
      // Stop active speaker monitoring and clean audio graph
      this.stopActiveSpeakerLoop();
      try {
        this.analyserNodes.forEach(node => node.disconnect());
        this.audioSources.forEach(src => src.disconnect());
      } catch {}
      this.analyserNodes.clear();
      this.audioSources.clear();
      this.speakingVolumes.clear();
      try { this.audioContext?.close(); } catch {}
      this.audioContext = undefined;
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
    this.peerAudioTransceiver.delete(userId);
    this.peerVideoTransceiver.delete(userId);
    this.removeAudioAnalysis(userId);
  }

  private changeDetectionTimeout: any = null;
  private readonly changeDetectionDelay = 8; // ~120fps for faster updates

  triggerChangeDetection() {
    // Use setTimeout to avoid excessive change detection cycles
    if (!this.changeDetectionTimeout) {
      this.changeDetectionTimeout = setTimeout(() => {
        this.cdr.detectChanges();
        this.changeDetectionTimeout = null;
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

      const base = this.cfg.apiBaseUrl;
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
      this.toast.error('Host bilgisi alınamadı. Yenileyip tekrar deneyin.');
      this.isHost = false;
    }
  }

  private async swapLocalVideoTrack(newTrack: MediaStreamTrack) {
    try {
      for (const [userId] of this.peerConnections) {
        const videoTx = this.peerVideoTransceiver.get(userId);
        if (videoTx) {
          await videoTx.sender.replaceTrack(newTrack);
        }
      }
    } catch (err) {
      console.warn('Error swapping local video track:', err);
    }
  }

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

  // ===== Active speaker detection =====
  private ensureAudioContext() {
    if (!this.audioContext) {
      try {
        this.audioContext = new (window as any).AudioContext();
      } catch (err) {
        console.warn('Failed to create AudioContext for active speaker detection:', err);
      }
    }
  }

  private setupAudioAnalysisForStream(userId: string, stream: MediaStream) {
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) return;

    this.ensureAudioContext();
    if (!this.audioContext) return;

    try {
      // Recreate nodes if already exist
      this.removeAudioAnalysis(userId);

      const src = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);

      this.audioSources.set(userId, src);
      this.analyserNodes.set(userId, analyser);
      this.speakingVolumes.set(userId, 0);
    } catch (err) {
      console.warn('setupAudioAnalysisForStream failed for', userId, err);
    }
  }

  private removeAudioAnalysis(userId: string) {
    try {
      const analyser = this.analyserNodes.get(userId);
      const src = this.audioSources.get(userId);
      if (analyser) {
        try { analyser.disconnect(); } catch {}
      }
      if (src) {
        try { src.disconnect(); } catch {}
      }
    } catch {}
    this.analyserNodes.delete(userId);
    this.audioSources.delete(userId);
    this.speakingVolumes.delete(userId);
  }

  private computeRmsFromAnalyser(analyser: AnalyserNode): number {
    const buffer = new Uint8Array((analyser as any).fftSize || 256);
    try {
      (analyser as any).getByteTimeDomainData(buffer);
    } catch {
      (analyser as any).getByteTimeDomainData(buffer);
    }
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = (buffer[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    return rms;
  }

  private startActiveSpeakerLoop() {
    if (this.activeSpeakerAnimationFrame != null) return;

    let lastUserId = '';
    let lastSwitchAt = performance.now();
    const minHoldMs = 1200;

    const tick = () => {
      // Update volumes
      this.analyserNodes.forEach((analyser, userId) => {
        try {
          const rms = this.computeRmsFromAnalyser(analyser);
          const level = Math.max(0, rms - 0.02);
          this.speakingVolumes.set(userId, level);
        } catch {}
      });

      // Find loudest
      let topUser: string | null = null;
      let topVal = 0;
      let secondVal = 0;
      this.speakingVolumes.forEach((val, uid) => {
        if (val > topVal) {
          secondVal = topVal;
          topVal = val;
          topUser = uid;
        } else if (val > secondVal) {
          secondVal = val;
        }
      });

      const now = performance.now();
      const threshold = 0.06;
      const margin = 0.03;

      if (topUser && topVal > threshold && (topVal - secondVal) > margin) {
        if ((topUser !== lastUserId && (now - lastSwitchAt) > minHoldMs) || !this.meetingState.activeSpeaker) {
          lastUserId = topUser;
          lastSwitchAt = now;
          if (this.meetingState.activeSpeaker !== topUser) {
            this.meetingState.activeSpeaker = topUser;
            this.triggerChangeDetection();
          }
        }
      }

      this.activeSpeakerAnimationFrame = requestAnimationFrame(tick);
    };

    this.activeSpeakerAnimationFrame = requestAnimationFrame(tick);
  }

  private stopActiveSpeakerLoop() {
    if (this.activeSpeakerAnimationFrame != null) {
      cancelAnimationFrame(this.activeSpeakerAnimationFrame);
      this.activeSpeakerAnimationFrame = null;
    }
  }

}
