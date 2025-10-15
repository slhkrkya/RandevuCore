import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, NgZone } from '@angular/core';
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

export interface ParticipantStateVersioned {
  userId: string;
  isVideoOn: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  wasVideoOnBeforeShare: boolean;
  version: number;
  timestamp: string;
  videoTrackArrived?: boolean;
  audioTrackArrived?: boolean;
  videoStatus?: 'on' | 'off' | 'pending';
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
export class MeetingRoomComponent implements OnInit, AfterViewInit, OnDestroy {
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

  participants: Participant[] = [];
  participantStatesVersioned: Map<string, ParticipantStateVersioned> = new Map();
  localStream?: MediaStream;
  private rawLocalStream?: MediaStream;
  remoteStreams: Map<string, MediaStream> = new Map();
  peerConnections: Map<string, RTCPeerConnection> = new Map();
  private peerAudioTransceiver: Map<string, RTCRtpTransceiver> = new Map();
  private peerVideoTransceiver: Map<string, RTCRtpTransceiver> = new Map();
  pendingIceCandidates: Map<string, RTCIceCandidate[]> = new Map();
  private makingOffer: Map<string, boolean> = new Map();
  private politeMap: Map<string, boolean> = new Map();

  private audioContext?: AudioContext;
  private audioSources: Map<string, MediaStreamAudioSourceNode> = new Map();
  private analyserNodes: Map<string, AnalyserNode> = new Map();
  private speakingVolumes: Map<string, number> = new Map();
  private activeSpeakerAnimationFrame: number | null = null;
  private wasVideoOnBeforeShare = false;

  showParticipantsPanel = false;
  showChatPanel = false;
  showWhiteboardPanel = false;
  isFullscreen = false;
  activeView: 'grid' | 'speaker' | 'whiteboard' = 'speaker';
  isInitializing = false;
  initializingMessage = 'Toplantı hazırlanıyor...';
  isVideoToggling = false;
  isScreenShareToggling = false;
  isMuteToggling = false;
  meetingDuration = '00:00:00';
  private negotiationTimers: Map<string, any> = new Map();
  private readonly negotiationDebounceMs = 350;

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
    this.isInitializing = true;
    this.initializingMessage = 'Toplantı hazırlanıyor...';
    
    try { await this.videoEffects.preload(); } catch {}
    await this.initializeMedia();
    await this.initializeMeeting();
    
    const refreshKey = `meeting-auto-refresh-${this.meetingId}`;
    const hasAutoRefreshed = sessionStorage.getItem(refreshKey);
    
    if (!hasAutoRefreshed) {
      sessionStorage.setItem(refreshKey, 'true');
      this.initializingMessage = 'Bağlantı optimize ediliyor...';
      setTimeout(() => window.location.reload(), 500);
      return;
    }
    
    this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
    });

    window.addEventListener('settingschange', this.handleSettingsChange);
    this.startActiveSpeakerLoop();

    try {
      const saved = localStorage.getItem('meeting.defaultView');
      if (saved === 'grid' || saved === 'speaker' || saved === 'whiteboard') {
        this.setActiveView(saved as any);
      }
    } catch {}
    
    setTimeout(() => {
      this.isInitializing = false;
      this.scheduleChangeDetection();
    }, 300);
  }

  ngAfterViewInit() {
    this.clearAllVideoElements();
    this.scheduleChangeDetection();
  }

  async ngOnDestroy() {
    window.removeEventListener('settingschange', this.handleSettingsChange);
    try { this.videoEffects.stop(); } catch {}
    
    const refreshKey = `meeting-auto-refresh-${this.meetingId}`;
    sessionStorage.removeItem(refreshKey);
    
    await this.cleanup();
  }

  private async initializeMeeting() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    this.roomKey = `meeting-${this.meetingId}`;
    
    const token = localStorage.getItem('token') || '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      this.currentUserId = payload.sub;
      this.currentUserName = payload.name || payload.email || 'User';
      await this.checkHostStatus();
    } catch (error) {
      console.error('Error parsing token:', error);
      this.router.navigate(['/login']);
      return;
    }

    await this.signalr.start(token);
    this.connected = true;
    this.setupSignalRListeners();
    await this.signalr.joinRoom(this.roomKey);
    this.signalr.invoke('GetMeetingDuration', this.roomKey);
  }

  private addCurrentUserAsParticipant() {
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
    this.signalr.on('meeting-duration', (duration: string) => {
      this.meetingDuration = duration;
      this.scheduleChangeDetection();
    });

    this.signalr.on('meeting-ended', () => {
      this.router.navigate(['/meetings']);
    });

    this.signalr.on<any>('presence', (participants) => {
      this.handlePresenceUpdate(participants);
    });
    
    this.signalr.on<any>('initial-participant-states', (states: any[]) => {
      this.handleInitialParticipantStates(states);
    });
    
    this.signalr.on<any>('participant-state-updated', (state: any) => {
      this.handleParticipantStateUpdated(state);
    });
    
    this.signalr.on<any>('participant-track-ready', (data: any) => {
      this.handleParticipantTrackReady(data);
    });

    this.signalr.on<any>('webrtc-offer', async (payload) => {
      await this.handleOffer(payload);
    });

    this.signalr.on<any>('webrtc-answer', async (payload) => {
      await this.handleAnswer(payload);
    });

    this.signalr.on<any>('webrtc-ice', async (payload) => {
      await this.handleIceCandidate(payload);
    });

    // ✅ REMOVED: Deprecated meeting-state-update handler - using unified participant-state-updated

    this.signalr.on<any>('perm-granted', async (permission) => {
      await this.handlePermissionGrant(permission);
    });

    this.signalr.on<any>('whiteboard-draw', (data) => {
    });

    this.signalr.on<any>('chat-message', (message) => {
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
      }
      
      // Broadcast initial state immediately after media is initialized
      // No setTimeout - broadcast happens synchronously after media setup
      await this.broadcastStateChange();
    } catch (error) {
      this.toast.error('Kamera/Mikrofon başlatılamadı. Ayarlarınızı kontrol edin.');
      // If media fails, continue without media - user can still participate
      this.meetingState.isVideoOn = false;
      this.meetingState.isMuted = true;
      
      // Broadcast state immediately even if media fails (no setTimeout)
      await this.broadcastStateChange();
    }
  }

  private handleSettingsChange = async () => {
    try {
      if (!this.rawLocalStream || !this.meetingState.isVideoOn) return;
      const settings = this.settingsService.settings().videoBackground;
      const processed = await this.videoEffects.apply(this.rawLocalStream, settings);
      this.localStream = processed;
      
      this.attachLocalTrackListeners();
      this.scheduleChangeDetection();
      
      const newTrack = this.localStream.getVideoTracks()[0];
      if (newTrack) {
        await this.swapLocalVideoTrack(newTrack);
      }
    } catch (err) {
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
          this.localStream = this.rawLocalStream;
        }
      } else {
        this.localStream = this.rawLocalStream;
      }

      // Notify UI and attach listeners
      this.attachLocalTrackListeners();
      this.scheduleChangeDetection();
      
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

  // ✅ UNIFIED: Single track replacement method
  private async replaceTrackForAllPeers(track: MediaStreamTrack | null, kind: 'audio' | 'video') {
    const replacePromises: Promise<void>[] = [];
    
    this.peerConnections.forEach((pc, userId) => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }
      
      const transceiver = kind === 'audio' 
        ? this.peerAudioTransceiver.get(userId)
        : this.peerVideoTransceiver.get(userId);
        
      if (transceiver) {
        // Determine direction based on track availability
        const shouldSend = !!track;
        transceiver.direction = shouldSend ? 'sendrecv' : 'recvonly';
        
        replacePromises.push(
          transceiver.sender.replaceTrack(track as any)
            .then(() => console.log(`✅ ${kind} track replaced for ${userId}`))
            .catch(err => console.warn(`⚠️ ${kind} track replace failed for ${userId}:`, err))
        );
      }
    });
    
    // Execute all replacements in parallel
    try {
      await Promise.allSettled(replacePromises);
    } catch (error) {
      console.error(`Error during ${kind} track replacement:`, error);
    }
  }

  private async updateAllPeerConnections() {
    console.log(`🔄 Updating all peer connections:`, {
      totalConnections: this.peerConnections.size,
      hasLocalStream: !!this.localStream,
      videoTracks: this.localStream?.getVideoTracks().length || 0,
      audioTracks: this.localStream?.getAudioTracks().length || 0,
      meetingState: this.meetingState
    });

    // ✅ UNIFIED: Use single track replacement method
    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const videoTrack = this.localStream?.getVideoTracks()[0] || null;
    
    // Handle audio track replacement
    const shouldSendAudio = !!audioTrack && !this.meetingState.isMuted;
    await this.replaceTrackForAllPeers(shouldSendAudio ? audioTrack : null, 'audio');
    
    // Handle video track replacement
    const shouldSendVideo = !!videoTrack && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing);
    await this.replaceTrackForAllPeers(shouldSendVideo ? videoTrack : null, 'video');
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
    const isVideoOn = videoTrack ? (videoTrack.enabled && videoTrack.readyState === 'live') : false;
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
    if (track.kind === 'video') {
      // Remove video track from stream and update state
      const stream = this.remoteStreams.get(userId);
      if (stream) {
        stream.removeTrack(track);
        
        // Update participant state to reflect video is off
        this.updateParticipantStateUnified(userId, { isVideoOn: false });
        
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
    
    this.scheduleChangeDetection();
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
      this.updateParticipantStateUnified(this.currentUserId, { isMuted: this.meetingState.isMuted });

      // Broadcast state change
      await this.broadcastStateChange();
      this.scheduleChangeDetection();
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
      const newVideoState = !this.meetingState.isVideoOn;
      if (newVideoState) {
        // Turn on camera
        await this.enableCamera();
        
        // CRITICAL: Wait for stream to be fully ready with video track
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
          throw new Error('Video track not available after enable');
        }
      } else {
        // Turn off camera
        await this.disableCamera();
      }
      
      this.meetingState.isVideoOn = newVideoState;
      
      // Update participant state via service BEFORE peer updates
      this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: this.meetingState.isVideoOn });
      
      // Attach listeners before updating peers
      this.attachLocalTrackListeners();
      
      // Update all peer connections with new stream
      await this.updateAllPeerConnections();
      
      // Small delay to ensure peer updates complete before broadcasting
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Broadcast state change AFTER peer connections updated
      await this.broadcastStateChange();
      
      // Notify UI
      this.scheduleChangeDetection();
      
      console.log(`✅ Video toggled successfully: ${this.meetingState.isVideoOn}`, {
        hasLocalStream: !!this.localStream,
        videoTracks: this.localStream?.getVideoTracks().length || 0,
        peerConnectionsCount: this.peerConnections.size
      });
    } catch (error) {
      console.error('Failed to toggle video:', error);
      this.toast.error('Kamera değiştirilemedi. Lütfen tekrar deneyin.');
      // Revert state on error
      this.meetingState.isVideoOn = !this.meetingState.isVideoOn;
      this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: this.meetingState.isVideoOn });
    } finally {
      // Add delay to prevent rapid clicking
      setTimeout(() => {
        this.isVideoToggling = false;
      }, 1000);
    }
  }
  
  private async enableCamera() {
    try {
      // Check if we already have a video track
      if (this.localStream && this.localStream.getVideoTracks().length > 0) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        videoTrack.enabled = true;
        return;
      }
      
      // Get fresh camera stream with video enabled
      const preferredCamera = localStorage.getItem('preferredCamera');
      const constraints: MediaStreamConstraints = {
        video: preferredCamera ? { deviceId: { exact: preferredCamera } } : true,
        audio: false // We'll handle audio separately
      };
      const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!videoStream || videoStream.getVideoTracks().length === 0) {
        throw new Error('Failed to get video stream');
      }
      
      console.log('✅ Got video stream:', {
        trackId: videoStream.getVideoTracks()[0]?.id,
        trackEnabled: videoStream.getVideoTracks()[0]?.enabled,
        trackReadyState: videoStream.getVideoTracks()[0]?.readyState
      });
      
      // Merge with existing audio if available
      if (this.localStream && this.localStream.getAudioTracks().length > 0) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        const combinedStream = new MediaStream([videoStream.getVideoTracks()[0], audioTrack]);
        this.rawLocalStream = combinedStream;
      } else {
        this.rawLocalStream = videoStream;
      }
      
      // Apply video effects if needed
      try {
        const settings = this.settingsService.settings().videoBackground;
        if (settings.mode !== 'none') {
          const processed = await this.videoEffects.apply(this.rawLocalStream, settings);
          if (processed && processed.getVideoTracks().length > 0) {
            this.localStream = processed;
          } else {
            this.localStream = this.rawLocalStream;
          }
        } else {
          this.localStream = this.rawLocalStream;
        }
      } catch (effectError) {
        this.localStream = this.rawLocalStream;
      }
      
      // Final verification
      if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
        throw new Error('Video track lost during processing');
      }
      
      console.log('✅ Camera enabled successfully', {
        trackId: this.localStream.getVideoTracks()[0]?.id,
        trackEnabled: this.localStream.getVideoTracks()[0]?.enabled,
        trackReadyState: this.localStream.getVideoTracks()[0]?.readyState
      });
      
    } catch (error) {
      console.error('Failed to enable camera:', error);
      throw error;
    }
  }
  
  private async disableCamera() {
    try {
      if (this.localStream && this.localStream.getVideoTracks().length > 0) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        videoTrack.stop(); // This will turn off the camera LED
        this.localStream.removeTrack(videoTrack);
        
        // Create audio-only stream
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
          this.localStream = new MediaStream(audioTracks);
        }
        
        // Stop video effects processing
        try { 
          this.videoEffects.stop(); 
        } catch {}
      }
    } catch (error) {
      console.error('Failed to disable camera:', error);
      throw error;
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
      
      // ✅ UNIFIED: Use single track replacement method for screen share
      await this.replaceTrackForAllPeers(screenTrack, 'video');

      this.meetingState.isScreenSharing = true;
      
      // Update participant state via unified method
      this.updateParticipantStateUnified(this.currentUserId, { isScreenSharing: true });

      // Handle screen share end
      screenTrack.onended = async () => {
        await this.stopScreenShare();
      };

      // Small delay before broadcasting to ensure tracks are set
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await this.broadcastStateChange();
      this.scheduleChangeDetection();
    } catch (error) {
      console.error('Screen share error:', error);
      this.toast.error('Ekran paylaşımı başlatılamadı.');
    }
  }

  private async stopScreenShare() {
    this.meetingState.isScreenSharing = false;
    
    // Update participant state via unified method
    this.updateParticipantStateUnified(this.currentUserId, { isScreenSharing: false });

    // Restore meetingState video flag to pre-share state
    if (this.wasVideoOnBeforeShare) {
      this.meetingState.isVideoOn = true;
      // If local camera track missing, try to reacquire video
      if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
        try { 
          await this.enableCamera();
        } catch (err) {
          this.meetingState.isVideoOn = false;
        }
      }
    }
    this.wasVideoOnBeforeShare = false;

    // ✅ UNIFIED: Use single track replacement method for camera restoration
    const cameraTrack = this.localStream?.getVideoTracks()[0] || null;
    const shouldSendVideo = !!cameraTrack && this.meetingState.isVideoOn;
    await this.replaceTrackForAllPeers(shouldSendVideo ? cameraTrack : null, 'video');
    
    // Small delay before broadcasting
    await new Promise(resolve => setTimeout(resolve, 100));

    await this.broadcastStateChange();
    this.scheduleChangeDetection();
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
    // IMPORTANT: Preserve existing state for participants already in the room
    const updatedParticipants = participants.map(p => {
      const existing = this.participants.find(ep => ep.userId === p.userId);
      
      if (existing) {
        // Keep existing state - it will be updated via meeting-state-update events
        return {
          ...p,
          isVideoOn: existing.isVideoOn,
          isMuted: existing.isMuted,
          isScreenSharing: existing.isScreenSharing,
          isWhiteboardEnabled: existing.isWhiteboardEnabled,
          isHost: p.userId === this.currentUserId ? this.isHost : existing.isHost
        };
      } else {
        // New participant - initialize with defaults
        // Their actual state will come via meeting-state-update broadcast
        return {
          ...p,
          isVideoOn: p.isVideoOn ?? false,
          isMuted: p.isMuted ?? false,
          isScreenSharing: p.isScreenSharing ?? false,
          isWhiteboardEnabled: p.isWhiteboardEnabled ?? false,
          isHost: p.userId === this.currentUserId ? this.isHost : false
        };
      }
    });
    
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
      console.log(`🆕 New participants joined: ${newParticipants.map(p => p.name).join(', ')}`);
      
      // ✅ ENHANCED: Serialize peer connection creation to prevent race conditions
      for (const participant of newParticipants) {
        try {
          // Check if connection already exists (double-check)
          if (!this.peerConnections.has(participant.userId)) {
            await this.createPeerConnection(participant.userId);
            console.log(`✅ Peer connection created for ${participant.name}`);
          }
        } catch (error) {
          console.error(`❌ Failed to create peer connection for ${participant.name}:`, error);
        }
      }
      
      await this.broadcastStateChange();
    }

    // ✅ UNIFIED: Remove connections for participants who left
    const currentParticipantIds = new Set(this.participants.map(p => p.userId));
    for (const [userId] of this.peerConnections) {
      if (!currentParticipantIds.has(userId)) {
        this.cleanupPeerConnection(userId);
      }
    }
    
    // ✅ FIXED: Single trigger point to prevent duplicate execution
    // This ensures that new participants can see existing participants' videos
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 500);
    
    this.scheduleChangeDetection();
  }

  private async createPeerConnection(userId: string) {
    // ✅ ENHANCED: Prevent duplicate peer connections
    if (this.peerConnections.has(userId)) {
      console.log(`⚠️ Peer connection already exists for ${userId}, skipping creation`);
      return;
    }
    
    console.log(`🔗 Creating peer connection for ${userId}`);
    
    const configuration: RTCConfiguration = { 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle' as RTCBundlePolicy,
      rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy
    };
    
    const pc = new RTCPeerConnection(configuration);
    
    // Store connection immediately to prevent race conditions
    this.peerConnections.set(userId, pc);
    
    console.log(`✅ Peer connection stored for ${userId}`);

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
        // Send LOCAL candidate to REMOTE peer via signaling (trickle ICE)
        try {
          this.signalr.sendToRoom(this.roomKey, 'webrtc-ice', {
            candidate: event.candidate,
            targetUserId: userId
          });
        } catch (err) {
        }
      }
    };

    pc.onconnectionstatechange = () => {
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
      const track = event.track;
      let stream = this.remoteStreams.get(userId);
      
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(userId, stream);
      }
      
      const existingTrack = stream.getTracks().find(t => t.id === track.id);
      if (existingTrack) {
        return;
      }
      
      try {
        stream.addTrack(track);
        this.signalr.invoke('NotifyTrackReady', this.roomKey, {
          participantUserId: userId,
          hasVideo: track.kind === 'video',
          hasAudio: track.kind === 'audio'
        }).catch(() => {});
        
        this.updateParticipantStateFromTracks(userId, stream);
        
        const versionedState = this.participantStatesVersioned.get(userId);
        if (versionedState) {
          if (track.kind === 'video') {
            versionedState.videoTrackArrived = true;
            if (versionedState.isVideoOn) {
              versionedState.videoStatus = 'on';
              this.updateParticipantStateUnified(userId, { isVideoOn: true });
            }
          }
          if (track.kind === 'audio') {
            versionedState.audioTrackArrived = true;
          }
          this.participantStatesVersioned.set(userId, versionedState);
        }
        
        if (track.kind === 'video') {
          this.scheduleChangeDetection();
        }
      } catch (error) {
      }
      track.onended = () => {
        this.handleTrackEnded(userId, track);
      };
      
      (track as any).onmute = () => {
        this.zone.run(() => {
          const latest = this.remoteStreams.get(userId);
          if (latest) {
            this.updateParticipantStateFromTracks(userId, latest);
            this.scheduleChangeDetection();
          }
        });
      };
      
      (track as any).onunmute = () => {
        this.zone.run(() => {
          const latest = this.remoteStreams.get(userId);
          if (latest) {
            this.updateParticipantStateFromTracks(userId, latest);
            this.scheduleChangeDetection();
          }
        });
      };
      
      if (track.kind === 'video') {
        this.scheduleChangeDetection();
      }
      
      if (track.kind === 'audio') {
        try {
          const stream = this.remoteStreams.get(userId);
          if (stream) {
            this.setupAudioAnalysisForStream(userId, stream);
          }
        } catch {}
      }
      
      this.scheduleChangeDetection();
      });
    };

    this.peerConnections.set(userId, pc);
    await this.applyLocalTracksToPc(pc);
    return pc;
  }

  // ✅ UNIFIED: Apply local tracks to single peer connection
  private async applyLocalTracksToPc(pc: RTCPeerConnection): Promise<void> {
    if (!pc) return;
    const entry = Array.from(this.peerConnections.entries()).find(([, val]) => val === pc);
    const userId = entry?.[0];
    if (!userId) return;

    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const videoTrack = this.localStream?.getVideoTracks()[0] || null;

    try {
      // Apply audio track
      const shouldSendAudio = !!audioTrack && !this.meetingState.isMuted;
      await this.replaceTrackForSinglePeer(userId, shouldSendAudio ? audioTrack : null, 'audio');
      
      // Apply video track
      const shouldSendVideo = !!videoTrack && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing);
      await this.replaceTrackForSinglePeer(userId, shouldSendVideo ? videoTrack : null, 'video');
    } catch (err) {
      console.warn('Error applying local tracks to PC:', err);
    }
  }
  
  // ✅ UNIFIED: Replace track for single peer
  private async replaceTrackForSinglePeer(userId: string, track: MediaStreamTrack | null, kind: 'audio' | 'video') {
    const transceiver = kind === 'audio' 
      ? this.peerAudioTransceiver.get(userId)
      : this.peerVideoTransceiver.get(userId);
      
    if (transceiver) {
      const shouldSend = !!track;
      transceiver.direction = shouldSend ? 'sendrecv' : 'recvonly';
      
      try {
        await transceiver.sender.replaceTrack(track as any);
        console.log(`✅ ${kind} track applied for ${userId}`);
      } catch (err) {
        console.warn(`⚠️ ${kind} track apply failed for ${userId}:`, err);
      }
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

    // ✅ ENHANCED: Ensure peer connection exists
    if (!pc) {
      console.error(`❌ Failed to create peer connection for ${fromUserId}`);
      return;
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
          await this.createPeerConnection(fromUserId);
        } catch (e) {
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
          await this.createPeerConnection(fromUserId);
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
      return;
    }

    if (candidate) {
      try {
        // Only add candidate if remote description is set
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          // Store for later processing when remote description is set
          if (!this.pendingIceCandidates.has(fromUserId)) {
            this.pendingIceCandidates.set(fromUserId, []);
          }
          this.pendingIceCandidates.get(fromUserId)!.push(candidate);
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  // ✅ ENHANCED: Handle initial state snapshot with track ready simulation
  private handleInitialParticipantStates(states: any[]) {
    console.log('📥 Received initial participant states:', states.length);
    
    states.forEach(state => {
      const versionedState: ParticipantStateVersioned = {
        userId: state.userId,
        isVideoOn: state.isVideoOn,
        isMuted: state.isMuted,
        isScreenSharing: state.isScreenSharing,
        wasVideoOnBeforeShare: state.wasVideoOnBeforeShare,
        version: state.version,
        timestamp: state.timestamp,
        videoTrackArrived: false,
        audioTrackArrived: false,
        videoStatus: state.isVideoOn ? 'pending' : 'off'
      };
      
      this.participantStatesVersioned.set(state.userId, versionedState);
      
      // Restore wasVideoOnBeforeShare for current user (screen share state persistence)
      if (state.userId === this.currentUserId && state.wasVideoOnBeforeShare !== undefined) {
        this.wasVideoOnBeforeShare = state.wasVideoOnBeforeShare;
      }
      
      // Update participant service with initial state
      this.participantService.updateParticipantState(state.userId, {
        isVideoOn: state.isVideoOn,
        isMuted: state.isMuted,
        isScreenSharing: state.isScreenSharing
      });
      
      console.log(`📊 Initial state for ${state.userId}:`, {
        isVideoOn: state.isVideoOn,
        videoStatus: versionedState.videoStatus,
        version: state.version
      });
    });
    
    // ✅ FIXED: Single trigger point to prevent duplicate execution
    // This fixes the "2nd session" problem where track ready events don't come
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 1000);
    
    this.scheduleChangeDetection();
  }
  
  // ✅ ENHANCED: Simulate track ready events for participants who already have streams
  private simulateTrackReadyEventsForExistingParticipants() {
    console.log('🔄 Simulating track ready events for existing participants');
    
    this.participantStatesVersioned.forEach((versionedState, userId) => {
      if (userId === this.currentUserId) return; // Skip current user
      
      const remoteStream = this.remoteStreams.get(userId);
      if (remoteStream) {
        const hasVideo = remoteStream.getVideoTracks().length > 0;
        const hasAudio = remoteStream.getAudioTracks().length > 0;
        
        if (hasVideo || hasAudio) {
          console.log(`🎬 Simulating track ready for ${userId}:`, { hasVideo, hasAudio });
          
          // Simulate track ready event
          this.handleParticipantTrackReady({
            userId: userId,
            hasVideo: hasVideo,
            hasAudio: hasAudio
          });
        }
      } else {
        // ✅ ENHANCED: Even if no stream yet, simulate based on participant state
        // This fixes the "B rejoin, A's camera open but B can't see A" problem
        if (versionedState.isVideoOn || versionedState.isScreenSharing) {
          console.log(`🎬 Simulating pending track ready for ${userId} (video should be on)`);
          
          // Simulate pending state - this will trigger video visibility
          this.handleParticipantTrackReady({
            userId: userId,
            hasVideo: true,  // Assume video should be available
            hasAudio: true   // Assume audio should be available
          });
        }
      }
    });
    
    // ✅ NEW: Force real track attachment for late join scenarios
    this.forceTrackAttachmentForLateJoin().catch(error => {
      console.warn('Error in force track attachment:', error);
    });
  }
  
  // ✅ NEW: Force real track attachment for late join scenarios
  private async forceTrackAttachmentForLateJoin() {
    console.log('🔗 Forcing track attachment for late join scenarios');
    
    // Get all participants who should have video/audio but don't have streams
    const participantsNeedingTracks = Array.from(this.participantStatesVersioned.entries())
      .filter(([userId, state]) => {
        if (userId === this.currentUserId) return false;
        
        const hasStream = this.remoteStreams.has(userId);
        const shouldHaveVideo = state.isVideoOn || state.isScreenSharing;
        const shouldHaveAudio = !state.isMuted;
        
        return (shouldHaveVideo || shouldHaveAudio) && !hasStream;
      });
    
    if (participantsNeedingTracks.length === 0) {
      console.log('✅ All participants already have their tracks');
      return;
    }
    
    console.log(`🔗 Found ${participantsNeedingTracks.length} participants needing track attachment:`, 
      participantsNeedingTracks.map(([userId, state]) => ({ userId, isVideoOn: state.isVideoOn, isMuted: state.isMuted })));
    
    // Force track attachment for each participant
    for (const [userId, state] of participantsNeedingTracks) {
      try {
        await this.forceTrackAttachmentForParticipant(userId, state);
      } catch (error) {
        console.error(`❌ Failed to force track attachment for ${userId}:`, error);
      }
    }
  }
  
  // ✅ ENHANCED: Ensure transceivers exist before track attachment
  private async ensureTransceiversExist(userId: string): Promise<boolean> {
    const pc = this.peerConnections.get(userId);
    if (!pc) return false;
    
    let audioTx = this.peerAudioTransceiver.get(userId);
    let videoTx = this.peerVideoTransceiver.get(userId);
    
    if (!audioTx) {
      try {
        audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        this.peerAudioTransceiver.set(userId, audioTx);
        console.log(`✅ Audio transceiver created for ${userId}`);
      } catch (error) {
        console.error(`❌ Failed to create audio transceiver for ${userId}:`, error);
        return false;
      }
    }
    
    if (!videoTx) {
      try {
        videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
        this.peerVideoTransceiver.set(userId, videoTx);
        console.log(`✅ Video transceiver created for ${userId}`);
      } catch (error) {
        console.error(`❌ Failed to create video transceiver for ${userId}:`, error);
        return false;
      }
    }
    
    return true;
  }

  // ✅ ENHANCED: Force track attachment for a specific participant
  private async forceTrackAttachmentForParticipant(userId: string, state: any) {
    console.log(`🔗 Forcing track attachment for ${userId}`);
    
    const pc = this.peerConnections.get(userId);
    if (!pc) {
      console.warn(`⚠️ No peer connection found for ${userId}`);
      return;
    }
    
    // Check if we have local tracks to send
    if (!this.localStream) {
      console.warn(`⚠️ No local stream available for track attachment`);
      return;
    }
    
    // ✅ ENHANCED: Ensure transceivers exist before proceeding
    const transceiversReady = await this.ensureTransceiversExist(userId);
    if (!transceiversReady) {
      console.warn(`⚠️ Failed to ensure transceivers for ${userId}`);
      return;
    }
    
    const videoTransceiver = this.peerVideoTransceiver.get(userId);
    const audioTransceiver = this.peerAudioTransceiver.get(userId);
    
    // ✅ FIXED: Use existing unified track replacement methods
    if (videoTransceiver && (state.isVideoOn || state.isScreenSharing)) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        console.log(`🎥 Attaching video track to ${userId}`);
        await this.replaceTrackForSinglePeer(userId, videoTrack, 'video');
      }
    }
    
    if (audioTransceiver && !state.isMuted) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        console.log(`🎤 Attaching audio track to ${userId}`);
        await this.replaceTrackForSinglePeer(userId, audioTrack, 'audio');
      }
    }
    
    // Trigger renegotiation if needed
    if (videoTransceiver || audioTransceiver) {
      console.log(`🔄 Triggering renegotiation for ${userId}`);
      // Note: Renegotiation will be handled by the existing offer/answer flow
      // when the peer connection state changes
    }
  }
  
  // ✅ UNIFIED: Single state update handler with version control
  private handleParticipantStateUpdated(state: any) {
    const userId = state.userId;
    const existingState = this.participantStatesVersioned.get(userId);
    
    // Version check - ignore older versions
    if (existingState && state.version <= existingState.version) {
      return;
    }
    
    // Check if we have track for this user
    const remoteStream = this.remoteStreams.get(userId);
    const hasVideoTrack = !!remoteStream && remoteStream.getVideoTracks().length > 0;
    const hasAudioTrack = !!remoteStream && remoteStream.getAudioTracks().length > 0;
    
    // Determine video status based on state and track arrival
    let videoStatus: 'on' | 'off' | 'pending' = 'off';
    if (state.isVideoOn) {
      videoStatus = hasVideoTrack ? 'on' : 'pending';
    }
    
    const versionedState: ParticipantStateVersioned = {
      userId: userId,
      isVideoOn: state.isVideoOn,
      isMuted: state.isMuted,
      isScreenSharing: state.isScreenSharing,
      wasVideoOnBeforeShare: state.wasVideoOnBeforeShare,
      version: state.version,
      timestamp: state.timestamp,
      videoTrackArrived: hasVideoTrack,
      audioTrackArrived: hasAudioTrack,
      videoStatus: videoStatus
    };
    
    this.participantStatesVersioned.set(userId, versionedState);
    
    // Restore wasVideoOnBeforeShare for current user (if updated)
    if (userId === this.currentUserId && state.wasVideoOnBeforeShare !== undefined) {
      this.wasVideoOnBeforeShare = state.wasVideoOnBeforeShare;
    }
    
    // ✅ SINGLE STATE UPDATE POINT
    this.updateParticipantStateUnified(userId, {
      isVideoOn: videoStatus === 'on', // Only show as on if track is ready
      isMuted: state.isMuted,
      isScreenSharing: state.isScreenSharing
    });
  }
  
  // ✅ ENHANCED: Handle track-ready event with better logging and state management
  private handleParticipantTrackReady(data: any) {
    const userId = data.userId;
    const versionedState = this.participantStatesVersioned.get(userId);
    if (!versionedState) {
      console.warn(`⚠️ No versioned state found for track ready event: ${userId}`);
      return;
    }
    
    console.log(`🎬 Track ready event for ${userId}:`, {
      hasVideo: data.hasVideo,
      hasAudio: data.hasAudio,
      currentVideoStatus: versionedState.videoStatus,
      isVideoOn: versionedState.isVideoOn
    });
    
    // Update track arrival flags
    if (data.hasVideo) {
      versionedState.videoTrackArrived = true;
      // If state says video is on and track is now ready, update status
      if (versionedState.isVideoOn) {
        versionedState.videoStatus = 'on';
        console.log(`✅ Video status updated to 'on' for ${userId}`);
        
        // Update participant service to show video
        this.updateParticipantStateUnified(userId, { isVideoOn: true });
      }
    }
    
    if (data.hasAudio) {
      versionedState.audioTrackArrived = true;
      console.log(`✅ Audio track arrived for ${userId}`);
    }
    
    this.participantStatesVersioned.set(userId, versionedState);
    
    // ✅ ENHANCED: Force immediate change detection and video element update
    this.scheduleChangeDetection();
    
    // ✅ REMOVED: Duplicate change detection - already handled by scheduleChangeDetection()
    
    // ✅ REMOVED: Duplicate track attachment - already handled in simulateTrackReadyEventsForExistingParticipants
  }
  
  // ✅ REMOVED: Unused function - change detection already handled by scheduleChangeDetection()
  
  // ✅ REMOVED: Deprecated handleMeetingStateUpdate method

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

  // ✅ ENHANCED: Atomic state update method with version control
  private updateParticipantStateUnified(userId: string, updates: Partial<Participant>) {
    const currentState = this.participantStatesVersioned.get(userId);
    if (!currentState) {
      console.warn(`⚠️ No versioned state found for ${userId}, skipping update`);
      return;
    }
    
    // Use version increment for atomic updates
    const newVersion = currentState.version + 1;
    const newState = { 
      ...currentState, 
      ...updates, 
      version: newVersion,
      timestamp: new Date().toISOString()
    };
    
    // Atomic update: set versioned state first, then update service
    this.participantStatesVersioned.set(userId, newState);
    this.participantService.updateParticipantState(userId, updates);
    
    // Schedule single change detection
    this.scheduleChangeDetection();
  }

  private async broadcastStateChange() {
    try {
      // Use versioned UpdateParticipantState for server-authoritative state
      await this.signalr.invoke('UpdateParticipantState', this.roomKey, {
        isVideoOn: this.meetingState.isVideoOn,
        isMuted: this.meetingState.isMuted,
        isScreenSharing: this.meetingState.isScreenSharing,
        wasVideoOnBeforeShare: this.wasVideoOnBeforeShare || null
      });
    } catch (error) {
      console.error('❌ Failed to update participant state:', error);
    }
  }

  // ✅ REMOVED: Deprecated refreshVideoElements method

  // Track processed ICE candidates to avoid duplicates
  private processedIceCandidates = new Set<string>();

  private generateIceCandidateId(candidate: any): string {
    return `${candidate.sdpMid || ''}_${candidate.candidate || ''}_${candidate.sdpMLineIndex || ''}`;
  }

  // Utility methods
  getVideoParticipants() {
    return this.participants;
  }
  
  // Get video status for a participant (on/off/pending)
  getParticipantVideoStatus(userId: string): 'on' | 'off' | 'pending' {
    const versionedState = this.participantStatesVersioned.get(userId);
    if (!versionedState) {
      // Fallback to checking actual stream
      const stream = this.remoteStreams.get(userId);
      const hasVideo = stream && stream.getVideoTracks().length > 0;
      return hasVideo ? 'on' : 'off';
    }
    return versionedState.videoStatus || 'off';
  }
  
  // Check if participant video is loading (pending state)
  isParticipantVideoLoading(userId: string): boolean {
    return this.getParticipantVideoStatus(userId) === 'pending';
  }
  
  // ✅ REMOVED: Unused getIsVideoLoadingFn method - components now have their own isVideoLoading methods

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
      // Clear auto-refresh flag so next join will refresh again
      const refreshKey = `meeting-auto-refresh-${this.meetingId}`;
      sessionStorage.removeItem(refreshKey);
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

  // Clear all video elements (called on init and cleanup)
  // Note: Video elements are now managed by child components (video-grid, speaker-view)
  private clearAllVideoElements() {
    try {
      // Video elements are cleared by child components in their own lifecycle hooks
      // This is kept for future compatibility if needed
    } catch (error) {
    }
  }

  private async cleanup() {
    try {
      console.log('🧹 Starting comprehensive cleanup...');
      
      // Clear change detection timeout
      if (this.changeDetectionTimeout) {
        clearTimeout(this.changeDetectionTimeout);
        this.changeDetectionTimeout = null;
      }

      // ✅ ENHANCED: Cleanup all peer connections with proper await
      const userIds = Array.from(this.peerConnections.keys());
      await Promise.all(userIds.map(userId => this.cleanupPeerConnection(userId)));
      
      // ✅ ENHANCED: Clear all state to prevent stale data on rejoin
      this.participantStatesVersioned.clear();
      this.processedIceCandidates.clear();
      this.makingOffer.clear();
      this.politeMap.clear();
      
      // Reset meeting state to prevent rejoin issues
      this.meetingState = {
        isMuted: false,
        isVideoOn: false,
        isScreenSharing: false,
        isWhiteboardActive: false
      };
      
      this.wasVideoOnBeforeShare = false;
      this.connected = false;
      
      // Clear all timers
      this.negotiationTimers.forEach(timer => clearTimeout(timer));
      this.negotiationTimers.clear();
      
      // Stop local media tracks to turn off camera LED
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            track.stop(); // This will turn off camera LED
          } catch (error) {
            console.warn('Error stopping local track:', error);
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

      // Aggressively clear video elements
      this.clearAllVideoElements();
      
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
      
      // ✅ ENHANCED: Clean up all event listeners
      this.eventListeners.forEach((_, id) => {
        this.removeEventListener(id);
      });
      this.eventListeners.clear();
      
      console.log('✅ Cleanup completed successfully');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // ✅ ENHANCED: Comprehensive cleanup method for peer connection
  private async cleanupPeerConnection(userId: string) {
    console.log(`🧹 Cleaning up peer connection for ${userId}`);
    
    // 1. Close peer connection gracefully
    const pc = this.peerConnections.get(userId);
    if (pc) {
      try {
        // Close all transceivers first
        pc.getTransceivers().forEach(transceiver => {
          try {
            transceiver.stop();
          } catch (error) {
            console.warn('Error stopping transceiver:', error);
          }
        });
        
        // Close peer connection
        pc.close();
        console.log(`✅ Peer connection closed for ${userId}`);
      } catch (error) {
        console.warn('Error closing peer connection:', error);
      }
    }
    
    // 2. Clear remote stream and stop all tracks
    const remoteStream = this.remoteStreams.get(userId);
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => {
        try {
          track.stop();
          console.log(`✅ Remote track stopped for ${userId}:`, track.kind);
        } catch (error) {
          console.warn('Error stopping remote track:', error);
        }
      });
    }
    
    // 3. Clear all related data structures
    this.peerConnections.delete(userId);
    this.remoteStreams.delete(userId);
    this.pendingIceCandidates.delete(userId);
    this.peerAudioTransceiver.delete(userId);
    this.peerVideoTransceiver.delete(userId);
    this.politeMap.delete(userId);
    this.makingOffer.delete(userId);
    this.participantStatesVersioned.delete(userId);
    
    // 4. Clear negotiation timer
    const timer = this.negotiationTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.negotiationTimers.delete(userId);
    }
    
    // 5. Remove audio analysis
    this.removeAudioAnalysis(userId);
    
    console.log(`✅ Complete cleanup finished for ${userId}`);
  }

  // ✅ OPTIMIZED: Single change detection scheduler
  private changeDetectionTimeout: any = null;
  private changeDetectionScheduled = false;
  private readonly changeDetectionDelay = 16; // ~60fps for better performance

  private scheduleChangeDetection() {
    // Prevent multiple scheduled detections
    if (this.changeDetectionScheduled) return;
    
    this.changeDetectionScheduled = true;
    this.changeDetectionTimeout = setTimeout(() => {
      // ✅ FIXED: Actually trigger change detection instead of recursive call
      this.cdr.detectChanges();
      this.changeDetectionTimeout = null;
      this.changeDetectionScheduled = false;
    }, this.changeDetectionDelay);
  }

  // ✅ REMOVED: Deprecated triggerChangeDetection method

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

      const base = this.cfg.apiBaseUrl || '';
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
    }
  }

  // ✅ ENHANCED: Event listener management with proper cleanup
  private eventListeners = new Map<string, { element: any, events: { [key: string]: Function } }>();
  private currentLocalVideoTrack?: MediaStreamTrack;
  
  private addEventListener(id: string, element: any, events: { [key: string]: Function }) {
    this.removeEventListener(id); // Clean up existing
    
    Object.entries(events).forEach(([event, handler]) => {
      element.addEventListener(event, handler);
    });
    
    this.eventListeners.set(id, { element, events });
  }
  
  private removeEventListener(id: string) {
    const listener = this.eventListeners.get(id);
    if (listener) {
      Object.entries(listener.events).forEach(([event, handler]) => {
        listener.element.removeEventListener(event, handler);
      });
      this.eventListeners.delete(id);
    }
  }
  
  private attachLocalTrackListeners() {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) {
      this.currentLocalVideoTrack = undefined;
      return;
    }
    if (this.currentLocalVideoTrack === track) return;

    // Clean up previous track listeners
    if (this.currentLocalVideoTrack) {
      this.removeEventListener('local-video-track');
    }

    this.currentLocalVideoTrack = track;
    
    const eventHandlers = {
      mute: () => {
        this.zone.run(() => {
          this.meetingState.isVideoOn = false;
          this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: false });
        });
      },
      unmute: () => {
        this.zone.run(() => {
          this.meetingState.isVideoOn = true;
          this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: true });
        });
      },
      ended: () => {
        this.zone.run(() => {
          this.meetingState.isVideoOn = false;
          this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: false });
        });
      }
    };
    
    this.addEventListener('local-video-track', track, eventHandlers);
  }

  // ===== Active speaker detection =====
  private ensureAudioContext() {
    if (!this.audioContext) {
      try {
        this.audioContext = new (window as any).AudioContext();
      } catch (err) {
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
    }
  }

  // ✅ ENHANCED: Proper audio analysis cleanup
  private removeAudioAnalysis(userId: string) {
    try {
      const analyser = this.analyserNodes.get(userId);
      const src = this.audioSources.get(userId);
      
      if (analyser) {
        try { 
          analyser.disconnect();
          console.log(`✅ Audio analyser disconnected for ${userId}`);
        } catch (error) {
          console.warn('Error disconnecting analyser:', error);
        }
      }
      
      if (src) {
        try { 
          src.disconnect();
          console.log(`✅ Audio source disconnected for ${userId}`);
        } catch (error) {
          console.warn('Error disconnecting audio source:', error);
        }
      }
    } catch (error) {
      console.warn('Error in removeAudioAnalysis:', error);
    }
    
    // Clear all related data
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
            this.scheduleChangeDetection();
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
