import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, merge, Subject, Subscription } from 'rxjs';
import { map, distinctUntilChanged, shareReplay, filter, tap } from 'rxjs/operators';
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
import { PermissionService } from '../../../core/services/permission.service';
import { MeetingStatusService } from '../../../core/services/meeting-status.service';

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

  // ✅ NEW: Track sending coordination to prevent conflicts
  private trackSendingInProgress = new Set<string>()
  private trackSendingDebounce = new Map<string, any>()

  // ✅ REACTIVE: Replace manual state with BehaviorSubjects for reactive updates
  private meetingStateSubject = new BehaviorSubject<MeetingState>({
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  });
  
  // ✅ REACTIVE: Observable for meeting state - replaces direct property access
  meetingState$ = this.meetingStateSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );
  
  // ✅ REACTIVE: Getter for backward compatibility with existing templates
  get meetingState(): MeetingState {
    return this.meetingStateSubject.value;
  }

  // ✅ REACTIVE: Participant states as reactive streams
  private participantStatesSubject = new BehaviorSubject<Map<string, ParticipantStateVersioned>>(new Map());
  participantStates$ = this.participantStatesSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );

  // ✅ REACTIVE: Remote streams as reactive stream
  private remoteStreamsSubject = new BehaviorSubject<Map<string, MediaStream>>(new Map());
  remoteStreams$ = this.remoteStreamsSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );

  // ✅ REACTIVE: Active speaker as reactive stream
  private activeSpeakerSubject = new BehaviorSubject<string | undefined>(undefined);
  activeSpeaker$ = this.activeSpeakerSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );

  // ✅ REACTIVE: UI state as reactive streams
  private showParticipantsPanelSubject = new BehaviorSubject<boolean>(false);
  showParticipantsPanel$ = this.showParticipantsPanelSubject.asObservable().pipe(distinctUntilChanged());
  
  private showChatPanelSubject = new BehaviorSubject<boolean>(false);
  showChatPanel$ = this.showChatPanelSubject.asObservable().pipe(distinctUntilChanged());
  
  private showWhiteboardPanelSubject = new BehaviorSubject<boolean>(false);
  showWhiteboardPanel$ = this.showWhiteboardPanelSubject.asObservable().pipe(distinctUntilChanged());
  
  private activeViewSubject = new BehaviorSubject<'grid' | 'speaker' | 'whiteboard'>('speaker');
  activeView$ = this.activeViewSubject.asObservable().pipe(distinctUntilChanged());
  
  private isInitializingSubject = new BehaviorSubject<boolean>(false);
  isInitializing$ = this.isInitializingSubject.asObservable().pipe(distinctUntilChanged());
  
  private initializingMessageSubject = new BehaviorSubject<string>('Toplantı hazırlanıyor...');
  initializingMessage$ = this.initializingMessageSubject.asObservable().pipe(distinctUntilChanged());
  
  private meetingDurationSubject = new BehaviorSubject<string>('00:00:00');
  meetingDuration$ = this.meetingDurationSubject.asObservable().pipe(distinctUntilChanged());

  // ✅ REACTIVE: Toggle states as reactive streams
  private isVideoTogglingSubject = new BehaviorSubject<boolean>(false);
  isVideoToggling$ = this.isVideoTogglingSubject.asObservable().pipe(distinctUntilChanged());
  
  private isScreenShareTogglingSubject = new BehaviorSubject<boolean>(false);
  isScreenShareToggling$ = this.isScreenShareTogglingSubject.asObservable().pipe(distinctUntilChanged());
  
  private isMuteTogglingSubject = new BehaviorSubject<boolean>(false);
  isMuteToggling$ = this.isMuteTogglingSubject.asObservable().pipe(distinctUntilChanged());

  // ✅ REACTIVE: Getter properties for backward compatibility
  get showParticipantsPanel(): boolean { return this.showParticipantsPanelSubject.value; }
  get showChatPanel(): boolean { return this.showChatPanelSubject.value; }
  get showWhiteboardPanel(): boolean { return this.showWhiteboardPanelSubject.value; }
  get activeView(): 'grid' | 'speaker' | 'whiteboard' { return this.activeViewSubject.value; }
  get isInitializing(): boolean { return this.isInitializingSubject.value; }
  get initializingMessage(): string { return this.initializingMessageSubject.value; }
  get meetingDuration(): string { return this.meetingDurationSubject.value; }
  get isVideoToggling(): boolean { return this.isVideoTogglingSubject.value; }
  get isScreenShareToggling(): boolean { return this.isScreenShareTogglingSubject.value; }
  get isMuteToggling(): boolean { return this.isMuteTogglingSubject.value; }

  // ✅ REACTIVE: Participants from service - already reactive
  participants$: Observable<Participant[]>;
  participants: Participant[] = [];

  // ✅ REACTIVE: Combined state for components that need multiple streams
  combinedState$: Observable<any>;

  // ✅ REACTIVE: Local stream as reactive stream
  private localStreamSubject = new BehaviorSubject<MediaStream | undefined>(undefined);
  localStream$ = this.localStreamSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );
  
  get localStream(): MediaStream | undefined {
    return this.localStreamSubject.value;
  }

  // ✅ REACTIVE: Getter for backward compatibility
  get participantStatesVersioned(): Map<string, ParticipantStateVersioned> {
    return this.participantStatesSubject.value;
  }
  
  get remoteStreams(): Map<string, MediaStream> {
    return this.remoteStreamsSubject.value;
  }

  // ✅ REACTIVE: WebRTC state management - kept as private for internal use
  private rawLocalStream?: MediaStream;
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

  isFullscreen = false;
  private negotiationTimers: Map<string, any> = new Map();
  private readonly negotiationDebounceMs = 350;

  // ✅ REACTIVE: Subscription management
  private subscriptions = new Subscription();
  
  // ✅ NEW: Prevent duplicate track sending operations
  private forceTrackSendingInProgress = false;

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
    private cfg: AppConfigService,
    private permissionService: PermissionService,
    private meetingStatus: MeetingStatusService
  ) {
    // ✅ REACTIVE: Initialize participants observable after service is available
    this.participants$ = this.participantService.participants$;
    
    // ✅ REACTIVE: Initialize combined state observable
    this.combinedState$ = combineLatest([
      this.meetingState$,
      this.participants$,
      this.remoteStreams$,
      this.activeSpeaker$
    ]).pipe(
      map(([meetingState, participants, remoteStreams, activeSpeaker]) => ({
        meetingState: { ...meetingState, activeSpeaker },
        participants,
        remoteStreams
      })),
      shareReplay(1)
    );
  }

  async ngOnInit() {
    // ✅ REACTIVE: Update initializing state through reactive stream
    this.isInitializingSubject.next(true);
    this.initializingMessageSubject.next('Toplantı hazırlanıyor...');
    
    try { await this.videoEffects.preload(); } catch {}
    await this.initializeMedia();
    await this.initializeMeeting();
    
    const refreshKey = `meeting-auto-refresh-${this.meetingId}`;
    const hasAutoRefreshed = sessionStorage.getItem(refreshKey);
    
    if (!hasAutoRefreshed) {
      sessionStorage.setItem(refreshKey, 'true');
      this.initializingMessageSubject.next('Bağlantı optimize ediliyor...');
      setTimeout(() => window.location.reload(), 500);
      return;
    }
    
    // ✅ REACTIVE: Subscribe to participants stream and update local array for backward compatibility
    this.subscriptions.add(
    this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
      })
    );

    window.addEventListener('settingschange', this.handleSettingsChange);
    this.startActiveSpeakerLoop();

    try {
      const saved = localStorage.getItem('meeting.defaultView');
      if (saved === 'grid' || saved === 'speaker' || saved === 'whiteboard') {
        this.setActiveView(saved as any);
      }
    } catch {}
    
    // ✅ REACTIVE: Update initializing state through reactive stream - no manual change detection needed
    setTimeout(() => {
      this.isInitializingSubject.next(false);
    }, 300);
  }

  ngAfterViewInit() {
    this.clearAllVideoElements();
    // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
  }

  async ngOnDestroy() {
    // ✅ NEW: Clear all debounce timeouts
    this.trackSendingDebounce.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.trackSendingDebounce.clear();
    this.trackSendingInProgress.clear();
    
    // ✅ REACTIVE: Clean up all subscriptions
    this.subscriptions.unsubscribe();
    
    window.removeEventListener('settingschange', this.handleSettingsChange);
    
    const refreshKey = `meeting-auto-refresh-${this.meetingId}`;
    sessionStorage.removeItem(refreshKey);
    
    // ✅ ENHANCED: Always cleanup camera resources on component destroy
    // This ensures camera LED turns off even if user navigates away
    try {
      await this.cleanupCameraResources();
    } catch (error) {
      // Ignore cleanup errors during component destruction
    }
    
    // Set meeting to background mode instead of full cleanup
    this.meetingStatus.setBackgroundMode(true);
    
    // Don't cleanup connections - keep them alive in background
    // await this.cleanup();
  }

  private async initializeMeeting() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    this.roomKey = `meeting-${this.meetingId}`;
    
    // Check if returning from background mode
    const currentMeeting = this.meetingStatus.currentMeeting();
    const isReturningFromBackground = currentMeeting && 
      currentMeeting.meetingId === this.meetingId && 
      currentMeeting.isBackground;
    
    const token = localStorage.getItem('token') || '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      this.currentUserId = payload.sub;
      this.currentUserName = payload.name || payload.email || 'User';
      await this.checkHostStatus();
    } catch (error) {
      this.router.navigate(['/login']);
      return;
    }

    if (!isReturningFromBackground) {
      // Only start new connection if not returning from background
      await this.signalr.start(token);
      this.connected = true;
      this.setupSignalRListeners();
      await this.signalr.joinRoom(this.roomKey);
      this.signalr.invoke('GetMeetingDuration', this.roomKey);
    } else {
      // Already connected, just set connected state
      this.connected = true;
      this.setupSignalRListeners();
      
      // Restore meeting state from background
      const savedState = currentMeeting.meetingState;
      if (savedState) {
        this.meetingStateSubject.next({
          isMuted: savedState.isMuted,
          isVideoOn: savedState.isVideoOn,
          isScreenSharing: savedState.isScreenSharing,
          isWhiteboardActive: savedState.isWhiteboardActive
        });
      }
    }
    
    // Update meeting status service
    if (isReturningFromBackground) {
      this.meetingStatus.setBackgroundMode(false);
    } else {
      this.meetingStatus.joinMeeting(this.meetingId, this.roomKey, 'Toplantı', this.isHost);
    }
    
    // Start updating meeting state periodically
    this.startMeetingStateSync();
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

  private startMeetingStateSync() {
    // Update meeting state every 2 seconds
    setInterval(() => {
      this.meetingStatus.updateMeetingState({
        isMuted: this.meetingState.isMuted,
        isVideoOn: this.meetingState.isVideoOn,
        isScreenSharing: this.meetingState.isScreenSharing,
        isWhiteboardActive: this.meetingState.isWhiteboardActive
      });
    }, 2000);
  }

  private setupSignalRListeners() {
    // ✅ REACTIVE: Wrap all SignalR events in NgZone for automatic change detection
    this.signalr.on('meeting-duration', (duration: string) => {
      this.zone.run(() => {
        this.meetingDurationSubject.next(duration);
      });
    });

    this.signalr.on('meeting-ended', () => {
      this.zone.run(() => {
      this.router.navigate(['/meetings']);
      });
    });

    this.signalr.on<any>('presence', (participants) => {
      this.zone.run(() => {
      this.handlePresenceUpdate(participants);
      });
    });
    
    this.signalr.on<any>('initial-participant-states', (states: any[]) => {
      this.zone.run(() => {
      this.handleInitialParticipantStates(states);
      });
    });
    
    this.signalr.on<any>('participant-state-updated', (state: any) => {
      this.zone.run(() => {
      this.handleParticipantStateUpdated(state);
      });
    });
    
    this.signalr.on<any>('participant-track-ready', (data: any) => {
      this.zone.run(() => {
      this.handleParticipantTrackReady(data);
      });
    });

    this.signalr.on<any>('webrtc-offer', async (payload) => {
      await this.zone.run(async () => {
      await this.handleOffer(payload);
      });
    });

    this.signalr.on<any>('webrtc-answer', async (payload) => {
      await this.zone.run(async () => {
      await this.handleAnswer(payload);
      });
    });

    this.signalr.on<any>('webrtc-ice', async (payload) => {
      await this.zone.run(async () => {
      await this.handleIceCandidate(payload);
    });
    });

    this.signalr.on<any>('perm-granted', async (permission) => {
      await this.zone.run(async () => {
      await this.handlePermissionGrant(permission);
      });
    });

    this.signalr.on<any>('whiteboard-draw', (data) => {
      this.zone.run(() => {
        // Handle whiteboard draw events
      });
    });

    this.signalr.on<any>('chat-message', (message) => {
      this.zone.run(() => {
        // Chat messages are handled by the chat panel component
        // No need to handle here as chat panel has its own listeners
      });
    });
  }

  private async initializeMedia() {
    try {
      // Load pre-join settings
      const cameraEnabled = localStorage.getItem('cameraEnabled') === 'true';
      const microphoneEnabled = localStorage.getItem('microphoneEnabled') === 'true';
      
      this.meetingState.isVideoOn = cameraEnabled;
      this.meetingState.isMuted = !microphoneEnabled;

      // ✅ NEW: Always initialize peer connections first for better stability
      await this.initializeAllPeerConnections();
      
      // Then try to get media if at least one is enabled
      if (cameraEnabled || microphoneEnabled) {
        await this.ensureLocalStream();
      } else {
        // Both camera and mic are disabled, but P2P connections are ready
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
      // ✅ FIXED: Handle audio device and volume changes
      await this.handleAudioSettingsChange();
      
      // Handle video background changes
      if (!this.rawLocalStream || !this.meetingState.isVideoOn) return;
      const settings = this.settingsService.settings().videoBackground;
      const processed = await this.videoEffects.apply(this.rawLocalStream, settings);
      this.localStreamSubject.next(processed);
      
      this.attachLocalTrackListeners();
      // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
      
      const newTrack = this.localStreamSubject.value?.getVideoTracks()[0];
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
        this.localStreamSubject.next(undefined);
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

      // ✅ FIXED: Use SettingsService device preferences
      const deviceSettings = this.settingsService.deviceSettings();
      
      if (deviceSettings.cameraDeviceId && cameraEnabled) {
        (constraints.video as any) = { deviceId: { exact: deviceSettings.cameraDeviceId } };
      }
      if (deviceSettings.microphoneDeviceId && finalAudioEnabled) {
        (constraints.audio as any) = { deviceId: { exact: deviceSettings.microphoneDeviceId } };
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
        // ✅ FIXED: Apply microphone volume from settings
        this.applyMicrophoneVolume(audioTrack);
      }

      // Cache raw
      this.rawLocalStream = rawStream;
      // Apply effects synchronously for first frame so local/remote see filtered without refresh
      if (cameraEnabled) {
        try {
          const vb = this.settingsService.settings().videoBackground;
          this.localStreamSubject.next(await this.videoEffects.apply(this.rawLocalStream, vb));
        } catch (e) {
          this.localStreamSubject.next(this.rawLocalStream);
        }
      } else {
        this.localStreamSubject.next(this.rawLocalStream);
      }

      // ✅ REACTIVE: Update local stream through reactive stream
      this.localStreamSubject.next(this.localStream);

      // Notify UI and attach listeners
      this.attachLocalTrackListeners();
      
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
      
      // ✅ NEW: Debounced track sending when local video is enabled
      // This fixes the issue where user can't see existing participants' videos until they toggle their own camera
      await this.debouncedTrackSending('video-enabled', 1000);
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

  // ✅ ENHANCED: Single track replacement method with optimized direction updates
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
        // ✅ ENHANCED: Determine direction based on track availability
        const shouldSend = !!track;
        const newDirection = shouldSend ? 'sendrecv' : 'recvonly';
        
        // Only update direction if it changed (performance optimization)
        if (transceiver.direction !== newDirection) {
          transceiver.direction = newDirection;
        }
        
        replacePromises.push(
          transceiver.sender.replaceTrack(track as any)
            .then(() => {
              if (track) {
              } else {
              }
            })
            .catch(err => {
            })
        );
      }
    });
    
    // Execute all replacements in parallel
    try {
      await Promise.allSettled(replacePromises);
      
      // ✅ FIXED: Force change detection after track replacement
      this.cdr.markForCheck();
    } catch (error) {
    }
  }

  private async updateAllPeerConnections() {

    // ✅ UNIFIED: Use single track replacement method
    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const videoTrack = this.localStream?.getVideoTracks()[0] || null;
    
    // Handle audio track replacement
    const shouldSendAudio = !!audioTrack && !this.meetingState.isMuted;
    await this.replaceTrackForAllPeers(shouldSendAudio ? audioTrack : null, 'audio');
    
    // Handle video track replacement
    const shouldSendVideo = !!videoTrack && (this.meetingState.isVideoOn || this.meetingState.isScreenSharing);
    await this.replaceTrackForAllPeers(shouldSendVideo ? videoTrack : null, 'video');
    
    // ✅ FIXED: Force change detection after peer connections updated
    this.cdr.markForCheck();
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
    
    // ✅ FIXED: Force change detection when remote track ends
    this.cdr.markForCheck();
  }

  // ✅ REACTIVE: Meeting controls with reactive state management
  async toggleMute() {
    if (this.isMuteTogglingSubject.value) return;
    
    this.isMuteTogglingSubject.next(true);
    
    try {
      const currentState = this.meetingStateSubject.value;
      const newMutedState = !currentState.isMuted;
      
      // ✅ REACTIVE: Update meeting state through reactive stream
      this.meetingStateSubject.next({
        ...currentState,
        isMuted: newMutedState
      });
      
      if (this.localStream && this.localStream.getAudioTracks()[0]) {
        // ✅ ENHANCED: Instant audio track enable/disable (P2P connections already exist)
        this.localStream.getAudioTracks()[0].enabled = !newMutedState;
      } else if (!newMutedState) {
        // Try to get microphone access if not available
        try {
          await this.ensureLocalStream();
        } catch (error) {
          this.toast.error('Mikrofon izni reddedildi veya kullanılamıyor.');
          // ✅ REACTIVE: Revert state through reactive stream
          this.meetingStateSubject.next({
            ...this.meetingStateSubject.value,
            isMuted: true
          });
          return;
        }
      }

      // Update participant state via service
      this.updateParticipantStateUnified(this.currentUserId, { isMuted: newMutedState });

      // Broadcast state change
      await this.broadcastStateChange();
    } catch (error) {
      // Mute toggle error occurred
    } finally {
      // Add small delay to prevent rapid clicking
      setTimeout(() => {
        this.isMuteTogglingSubject.next(false);
      }, 500);
    }
  }

  async toggleVideo() {
    if (this.isVideoToggling) return;
    
    this.isVideoTogglingSubject.next(true);
    
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
      
      // ✅ ENHANCED: Optimized peer connection updates (P2P connections already exist)
      await this.updateAllPeerConnections();
      
      // ✅ ENHANCED: Reduced delay since P2P connections are already established
      await new Promise(resolve => setTimeout(resolve, 25));
      
      // Broadcast state change AFTER peer connections updated
      await this.broadcastStateChange();
      
      // ✅ FIXED: Force change detection for avatar cards after video toggle
      this.cdr.markForCheck();
      
      // Notify UI
      // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
      
      // Video toggle completed successfully
    } catch (error) {
      this.toast.error('Kamera değiştirilemedi. Lütfen tekrar deneyin.');
      // Revert state on error
      this.meetingState.isVideoOn = !this.meetingState.isVideoOn;
      this.updateParticipantStateUnified(this.currentUserId, { isVideoOn: this.meetingState.isVideoOn });
    } finally {
      // Add delay to prevent rapid clicking
      setTimeout(() => {
        this.isVideoTogglingSubject.next(false);
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
      
      // ✅ FIXED: Get fresh camera stream with SettingsService device preferences
      const deviceSettings = this.settingsService.deviceSettings();
      const constraints: MediaStreamConstraints = {
        video: deviceSettings.cameraDeviceId ? { deviceId: { exact: deviceSettings.cameraDeviceId } } : true,
        audio: false // We'll handle audio separately
      };
      const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!videoStream || videoStream.getVideoTracks().length === 0) {
        throw new Error('Failed to get video stream');
      }
      
      // Video stream obtained successfully
      
      // Merge with existing audio if available
      if (this.localStream && this.localStream.getAudioTracks().length > 0) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        const combinedStream = new MediaStream([videoStream.getVideoTracks()[0], audioTrack]);
        this.rawLocalStream = combinedStream;
      } else {
        this.rawLocalStream = videoStream;
      }
      
      // Apply video effects if needed (including mirror preview)
      try {
        const settings = this.settingsService.settings().videoBackground;
        // Apply effects if there are any background effects OR mirror preview
        if (settings.mode !== 'none' || settings.mirrorPreview) {
          const processed = await this.videoEffects.apply(this.rawLocalStream, settings);
          if (processed && processed.getVideoTracks().length > 0) {
            this.localStreamSubject.next(processed);
          } else {
            this.localStreamSubject.next(this.rawLocalStream);
          }
        } else {
          this.localStreamSubject.next(this.rawLocalStream);
        }
      } catch (effectError) {
        this.localStreamSubject.next(this.rawLocalStream);
      }
      
      // Final verification
      if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
        throw new Error('Video track lost during processing');
      }
      
      // ✅ FIXED: Force change detection after camera is enabled
      this.cdr.markForCheck();
      
      // Camera enabled successfully
      
    } catch (error) {
      throw error;
    }
  }
  
  private async disableCamera() {
    try {
      if (this.localStream && this.localStream.getVideoTracks().length > 0) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        
        // ✅ ENHANCED: Ensure camera LED turns off immediately
        videoTrack.stop(); // This will turn off the camera LED
        this.localStream.removeTrack(videoTrack);
        
        // Also stop video track from raw stream
        if (this.rawLocalStream && this.rawLocalStream.getVideoTracks().length > 0) {
          const rawVideoTrack = this.rawLocalStream.getVideoTracks()[0];
          rawVideoTrack.stop(); // Additional stop to ensure LED turns off
        }
        
        // Create audio-only stream
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
          this.localStreamSubject.next(new MediaStream(audioTracks));
        } else {
          this.localStreamSubject.next(undefined);
        }
        
        // Stop video effects processing
        try { 
          this.videoEffects.stop(); 
        } catch {}
        
        // ✅ FIXED: Force change detection after camera is disabled
        this.cdr.markForCheck();
      }
    } catch (error) {
      throw error;
    }
  }

  async toggleScreenShare() {
    if (this.isScreenShareToggling) return;
    
    this.isScreenShareTogglingSubject.next(true);
    
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
        this.isScreenShareTogglingSubject.next(false);
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
          cam.stop(); // This will turn off the camera LED
          this.localStream.removeTrack(cam);
          
          // Also stop from raw stream to ensure LED turns off
          if (this.rawLocalStream && this.rawLocalStream.getVideoTracks()[0]) {
            const rawCam = this.rawLocalStream.getVideoTracks()[0];
            rawCam.stop(); // Additional stop to ensure LED turns off
          }
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
      // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
    } catch (error) {
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
    // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
  }

  // ✅ REACTIVE: UI controls with reactive state management
  toggleParticipantsPanel() {
    const newShowParticipants = !this.showParticipantsPanelSubject.value;
    this.showParticipantsPanelSubject.next(newShowParticipants);
    
    // If opening participants panel, close chat panel
    if (newShowParticipants) {
      this.showChatPanelSubject.next(false);
    }
  }

  toggleChatPanel() {
    const newShowChat = !this.showChatPanelSubject.value;
    this.showChatPanelSubject.next(newShowChat);
    
    // If opening chat panel, close participants panel
    if (newShowChat) {
      this.showParticipantsPanelSubject.next(false);
    }
  }

  toggleWhiteboardPanel() {
    const newShowWhiteboard = !this.showWhiteboardPanelSubject.value;
    this.showWhiteboardPanelSubject.next(newShowWhiteboard);
    
    // ✅ REACTIVE: Update meeting state through reactive stream
    const currentMeetingState = this.meetingStateSubject.value;
    this.meetingStateSubject.next({
      ...currentMeetingState,
      isWhiteboardActive: newShowWhiteboard
    });
    
    if (newShowWhiteboard) {
      this.activeViewSubject.next('whiteboard');
    } else {
      this.activeViewSubject.next('grid');
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
    this.activeViewSubject.next(view);
    
    if (view === 'whiteboard') {
      this.showWhiteboardPanelSubject.next(true);
      // ✅ REACTIVE: Update meeting state through reactive stream
      const currentMeetingState = this.meetingStateSubject.value;
      this.meetingStateSubject.next({
        ...currentMeetingState,
        isWhiteboardActive: true
      });
    } else {
      this.showWhiteboardPanelSubject.next(false);
      // ✅ REACTIVE: Update meeting state through reactive stream
      const currentMeetingState = this.meetingStateSubject.value;
      this.meetingStateSubject.next({
        ...currentMeetingState,
        isWhiteboardActive: false
      });
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
      // New participants joined
      
      // ✅ ENHANCED: Serialize peer connection creation to prevent race conditions
      for (const participant of newParticipants) {
        try {
          // Check if connection already exists (double-check)
          if (!this.peerConnections.has(participant.userId)) {
        await this.createPeerConnection(participant.userId);
            // Peer connection created successfully
          }
        } catch (error) {
          // Peer connection creation failed
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
    
    // ✅ ENHANCED: Multiple trigger points for better late joiner support
    // This ensures that new participants can see existing participants' videos
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 500);
    
    // ✅ NEW: Additional delayed trigger for stubborn cases
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 2000);
    
    // ✅ NEW: Final attempt for very late joiners
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 5000);
    
    // ✅ NEW: Debounced track sending for rejoin scenarios
    this.debouncedTrackSending('screen-share-started', 1000);
    
    // ✅ FIXED: Force track sending for rejoin scenarios
    // This is the key fix for the rejoin video visibility issue
    setTimeout(() => {
      this.forceTrackSendingForRejoinScenarios();
    }, 1000);
    
    // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
  }

  // ✅ NEW: Initialize all peer connections for better stability
  private async initializeAllPeerConnections() {
    // Get participants from the local array
    const participants = this.participants;
    const connectionPromises = participants
      .filter((p: any) => p.userId !== this.currentUserId)
      .map((p: any) => this.createPeerConnection(p.userId));
    
    await Promise.allSettled(connectionPromises);
  }

  // ✅ NEW: Helper method to check if local media stream exists
  private hasLocalMediaStream(): boolean {
    return !!(this.localStream && (
      this.localStream.getAudioTracks().length > 0 || 
      this.localStream.getVideoTracks().length > 0
    ));
  }

  private async createPeerConnection(userId: string) {
    // ✅ ENHANCED: Prevent duplicate peer connections
    if (this.peerConnections.has(userId)) {
      return;
    }
    
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

    // Determine polite role deterministically to avoid glare
    const polite = this.currentUserId < userId;
    this.politeMap.set(userId, polite);

    // ✅ ENHANCED: Create transceivers with smart direction based on media availability
    try {
      const hasLocalMedia = this.hasLocalMediaStream();
      const audioTx = pc.addTransceiver('audio', { 
        direction: hasLocalMedia ? 'sendrecv' : 'recvonly' 
      });
      const videoTx = pc.addTransceiver('video', { 
        direction: hasLocalMedia ? 'sendrecv' : 'recvonly' 
      });
      this.peerAudioTransceiver.set(userId, audioTx);
      this.peerVideoTransceiver.set(userId, videoTx);
      
    } catch {}

    // Enable ICE candidate signaling for better connectivity
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        // Send LOCAL candidate to REMOTE peer via signaling (trickle ICE)
        try {
          await this.signalr.invoke('SendIceCandidate', this.roomKey, {
            targetUserId: userId,
            candidate: event.candidate
          });
        } catch (err) {
          // ICE candidate send failed
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
          
          // Enhanced state validation - only proceed if we can make an offer
          if (pc.signalingState !== 'stable') {
            return;
          }
          this.makingOffer.set(uid, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await this.signalr.invoke('SendOffer', this.roomKey, {
            targetUserId: uid,
            offer: pc.localDescription
          });
        } catch (err) {
          // Negotiation error occurred
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
        const currentRemoteStreams = this.remoteStreamsSubject.value;
        let stream = currentRemoteStreams.get(userId);
      
      if (!stream) {
        stream = new MediaStream();
          // ✅ REACTIVE: Update remote streams through reactive stream
          const newRemoteStreams = new Map(currentRemoteStreams);
          newRemoteStreams.set(userId, stream);
          this.remoteStreamsSubject.next(newRemoteStreams);
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
        
          const currentStates = this.participantStatesSubject.value;
          const versionedState = currentStates.get(userId);
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
            // ✅ REACTIVE: Update participant states through reactive stream
            const newStates = new Map(currentStates);
            newStates.set(userId, versionedState);
            this.participantStatesSubject.next(newStates);
        }
        
        // ✅ FIXED: Validate and fix participant states when track arrives
        // This ensures that if a track arrives but participant state is incorrect, we fix it
        setTimeout(() => {
          this.validateAndFixParticipantStates();
        }, 100);
        
      } catch (error) {
          // Track handling error occurred
      }
        
      track.onended = () => {
        this.handleTrackEnded(userId, track);
      };
      
      (track as any).onmute = () => {
        this.zone.run(() => {
            const currentRemoteStreams = this.remoteStreamsSubject.value;
            const latest = currentRemoteStreams.get(userId);
          if (latest) {
            this.updateParticipantStateFromTracks(userId, latest);
          }
          
          // ✅ FIXED: Force change detection when remote track is muted
          this.cdr.markForCheck();
        });
      };
      
      (track as any).onunmute = () => {
        this.zone.run(() => {
            const currentRemoteStreams = this.remoteStreamsSubject.value;
            const latest = currentRemoteStreams.get(userId);
          if (latest) {
            this.updateParticipantStateFromTracks(userId, latest);
          }
          
          // ✅ FIXED: Force change detection when remote track is unmuted
          this.cdr.markForCheck();
        });
      };
      
      if (track.kind === 'audio') {
        try {
            const currentRemoteStreams = this.remoteStreamsSubject.value;
            const stream = currentRemoteStreams.get(userId);
          if (stream) {
            this.setupAudioAnalysisForStream(userId, stream);
          }
        } catch {}
      }
      });
    };

    this.peerConnections.set(userId, pc);
    await this.applyLocalTracksToPc(pc);
    
    // ✅ NEW: Debounced track sending to prevent conflicts
    // This fixes the issue where new joiner can't see existing participants' videos
    await this.debouncedTrackSendingToSpecificUser(userId, 'new-joiner', 1000);
    
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
      // Error applying local tracks to peer connection
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
    } catch (err) {
        // Track apply failed
      }
    }
  }

  private async handleOffer(payload: any) {
    const { fromUserId, offer, targetUserId } = payload;
    if (targetUserId !== this.currentUserId) return;

    let pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      pc = await this.createPeerConnection(fromUserId);
    }

    // ✅ ENHANCED: Ensure peer connection exists
    if (!pc) {
      return;
    }

    try {
      const polite = this.politeMap.get(fromUserId) ?? true;
      const offerCollision = pc.signalingState !== 'stable';
      
      if (offerCollision) {
        if (!polite) {
          return;
        }
        try { 
          await pc.setLocalDescription({ type: 'rollback' } as any); 
        } catch (rollbackError) {
          this.cleanupPeerConnection(fromUserId);
          pc = await this.createPeerConnection(fromUserId);
          if (!pc) return;
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Process pending ICE candidates
      await this.processPendingIceCandidates(fromUserId);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await this.signalr.invoke('SendAnswer', this.roomKey, {
        targetUserId: fromUserId,
        answer: pc.localDescription
      });
    } catch (error) {
      // Enhanced error handling for different WebRTC states
      const errorMessage = (error as any)?.message || '';
      const isStateError = errorMessage.includes('wrong state') || errorMessage.includes('stable');
      const isSdpError = errorMessage.includes('m-lines') || errorMessage.includes('order');
      
      if (isStateError || isSdpError) {
        try {
          this.cleanupPeerConnection(fromUserId);
          await this.createPeerConnection(fromUserId);
        } catch (e) {
          // Connection recreation failed
        }
      }
    }
  }

  private async handleAnswer(payload: any) {
    const { fromUserId, answer, targetUserId } = payload;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (!pc) {
      return;
    }

    try {
      if (pc.signalingState !== 'have-local-offer') {
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      
      // Process pending ICE candidates
      await this.processPendingIceCandidates(fromUserId);
    } catch (error) {
      // Self-heal on SDP/m-line issues
      const isSdpOrderError = (error as any)?.message?.includes('m-lines') || (error as any)?.message?.includes('order');
      if (isSdpOrderError) {
        try {
          this.cleanupPeerConnection(fromUserId);
          await this.createPeerConnection(fromUserId);
        } catch (e) {
          // Self-heal failed
        }
      }
    }
  }

  private async handleIceCandidate(payload: any) {
    const { fromUserId, candidate, targetUserId } = payload;
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
        // ICE candidate addition failed
      }
    }
  }

  // ✅ ENHANCED: Handle initial state snapshot with track ready simulation
  private handleInitialParticipantStates(states: any[]) {
    
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
      
      // Initial state processed
    });
    
    // ✅ FIXED: Check if we have remote streams for participants who should have video
    // This is the key fix for rejoin scenarios where initial state might be incorrect
    setTimeout(() => {
      this.validateAndFixParticipantStates();
    }, 500);
    
    // ✅ ENHANCED: Multiple trigger points for better late joiner support
    // This fixes the "2nd session" problem where track ready events don't come
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 1000);
    
    // ✅ NEW: Additional delayed trigger for stubborn cases
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 3000);
    
    // ✅ NEW: Final attempt for very late joiners
    setTimeout(() => {
      this.simulateTrackReadyEventsForExistingParticipants();
    }, 6000);
    
    // ✅ NEW: Debounced track sending for initial states
    this.debouncedTrackSending('initial-states', 1500);
    
    // ✅ FIXED: Force track sending for initial states - key fix for rejoin scenarios
    setTimeout(() => {
      this.forceTrackSendingForRejoinScenarios();
    }, 2000);
    
    // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
  }
  
  // ✅ NEW: Validate and fix participant states based on actual streams
  private validateAndFixParticipantStates() {
    
    this.participantStatesVersioned.forEach((versionedState, userId) => {
      if (userId === this.currentUserId) return; // Skip current user
      
      const remoteStream = this.remoteStreams.get(userId);
      const hasVideoTrack = remoteStream && remoteStream.getVideoTracks().length > 0;
      const hasAudioTrack = remoteStream && remoteStream.getAudioTracks().length > 0;
      
      // Check if participant should have video based on actual stream
      if (hasVideoTrack && !versionedState.isVideoOn) {
        // Update versioned state
        versionedState.isVideoOn = true;
        versionedState.videoTrackArrived = true;
        versionedState.videoStatus = 'on';
        
        this.participantStatesVersioned.set(userId, versionedState);
        
        // Update participant service
        this.updateParticipantStateUnified(userId, { isVideoOn: true });
        
      }
      
      // Check if participant should have audio based on actual stream
      if (hasAudioTrack && versionedState.isMuted) {
        // Update versioned state
        versionedState.isMuted = false;
        versionedState.audioTrackArrived = true;
        
        this.participantStatesVersioned.set(userId, versionedState);
        
        // Update participant service
        this.updateParticipantStateUnified(userId, { isMuted: false });
        
      }
    });
    
    // State validation completed
  }
  
  // ✅ ENHANCED: Simulate track ready events for participants who already have streams
  private simulateTrackReadyEventsForExistingParticipants() {

    this.participantStatesVersioned.forEach((versionedState, userId) => {
      if (userId === this.currentUserId) return; // Skip current user

      const remoteStream = this.remoteStreams.get(userId);
      if (remoteStream) {
        const hasVideo = remoteStream.getVideoTracks().length > 0;
        const hasAudio = remoteStream.getAudioTracks().length > 0;

        if (hasVideo || hasAudio) {
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
          // Simulate pending state - this will trigger video visibility
          this.handleParticipantTrackReady({
            userId: userId,
            hasVideo: true,  // Assume video should be available
            hasAudio: true   // Assume audio should be available
          });
        }
      }
    });

    // ✅ ENHANCED: Force real track attachment for late join scenarios with multiple attempts
    this.forceTrackAttachmentForLateJoin().catch(error => {
    });
    
    // ✅ NEW: Additional delayed attempt for stubborn cases
    setTimeout(() => {
      this.forceTrackAttachmentForLateJoin().catch(error => {
      });
    }, 2000);
    
    // ✅ NEW: Debounced track sending for late join scenarios
    this.debouncedTrackSending('late-join', 1000);
  }
  
  // ✅ ENHANCED: Force real track attachment for late join scenarios
  private async forceTrackAttachmentForLateJoin() {
    
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
      return;
    }
    
    
    // ✅ ENHANCED: Force track attachment for each participant with retry logic
    for (const [userId, state] of participantsNeedingTracks) {
      try {
        await this.forceTrackAttachmentForParticipant(userId, state);
        
        // ✅ NEW: Verify track attachment was successful
        setTimeout(async () => {
          const stream = this.remoteStreams.get(userId);
          if (!stream && (state.isVideoOn || state.isScreenSharing)) {
            try {
              await this.forceTrackAttachmentForParticipant(userId, state);
            } catch (retryError) {
            }
          }
        }, 1000);
        
      } catch (error) {
      }
    }
  }
  
  // ✅ ENHANCED: Ensure transceivers exist before track attachment with better error handling
  private async ensureTransceiversExist(userId: string): Promise<boolean> {
    const pc = this.peerConnections.get(userId);
    if (!pc) {
      return false;
    }

    // Check if peer connection is in a valid state
    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      return false;
    }

    let audioTx = this.peerAudioTransceiver.get(userId);
    let videoTx = this.peerVideoTransceiver.get(userId);

    if (!audioTx) {
      try {
        audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        this.peerAudioTransceiver.set(userId, audioTx);
      } catch (error) {
        return false;
      }
    }

    if (!videoTx) {
      try {
        videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
        this.peerVideoTransceiver.set(userId, videoTx);
      } catch (error) {
        return false;
      }
    }

    return true;
  }

  // ✅ ENHANCED: Force track attachment for a specific participant with comprehensive validation
  private async forceTrackAttachmentForParticipant(userId: string, state: any) {
    
    const pc = this.peerConnections.get(userId);
    if (!pc) {
      return;
    }

    // Check if peer connection is in a valid state
    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      return;
    }

    // Check if we have local tracks to send
    if (!this.localStream) {
      return;
    }

    // ✅ ENHANCED: Ensure transceivers exist before proceeding
    const transceiversReady = await this.ensureTransceiversExist(userId);
    if (!transceiversReady) {
      return;
    }

    const videoTransceiver = this.peerVideoTransceiver.get(userId);
    const audioTransceiver = this.peerAudioTransceiver.get(userId);

    // ✅ ENHANCED: Use existing unified track replacement methods with validation
    if (videoTransceiver && (state.isVideoOn || state.isScreenSharing)) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          await this.replaceTrackForSinglePeer(userId, videoTrack, 'video');
          
          // ✅ NEW: Verify track was actually attached
          setTimeout(() => {
            const sender = videoTransceiver.sender;
            if (sender.track && sender.track.id === videoTrack.id) {
            } else {
            }
          }, 500);
        } catch (error) {
        }
      }
    }

    if (audioTransceiver && !state.isMuted) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        try {
          await this.replaceTrackForSinglePeer(userId, audioTrack, 'audio');
          
          // ✅ NEW: Verify track was actually attached
          setTimeout(() => {
            const sender = audioTransceiver.sender;
            if (sender.track && sender.track.id === audioTrack.id) {
            } else {
            }
          }, 500);
        } catch (error) {
        }
      }
    }

    // ✅ ENHANCED: Trigger renegotiation with validation
    if (videoTransceiver || audioTransceiver) {
      
      // Force renegotiation by creating a new offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.signalr.invoke('SendOffer', this.roomKey, {
          targetUserId: userId,
          offer: offer
        });
      } catch (error) {
      }
    }
  }
  
  // ✅ NEW: Debounced track sending to prevent conflicts
  private async debouncedTrackSending(operation: string, delay: number = 1000) {
    const key = `track-sending-${operation}`;
    
    // Clear existing timeout
    const existingTimeout = this.trackSendingDebounce.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(async () => {
      this.trackSendingDebounce.delete(key);
      await this.forceExistingParticipantsToSendTracks();
    }, delay);
    
    this.trackSendingDebounce.set(key, timeout);
  }
  
  // ✅ NEW: Debounced track sending to specific user
  private async debouncedTrackSendingToSpecificUser(targetUserId: string, operation: string, delay: number = 1000) {
    const key = `track-sending-specific-${targetUserId}-${operation}`;
    
    // Clear existing timeout
    const existingTimeout = this.trackSendingDebounce.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(async () => {
      this.trackSendingDebounce.delete(key);
      await this.forceExistingParticipantsToSendTracksToSpecificUser(targetUserId);
    }, delay);
    
    this.trackSendingDebounce.set(key, timeout);
  }
  
  // ✅ NEW: Force existing participants to send their tracks to new joiner
  private async forceExistingParticipantsToSendTracks() {
    
    // ✅ ENHANCED: Prevent duplicate execution
    if (this.forceTrackSendingInProgress) {
      return;
    }
    
    this.forceTrackSendingInProgress = true;
    
    try {
      // Get all participants who should have video/audio and send their tracks
      const participantsWithTracks = Array.from(this.participantStatesVersioned.entries())
        .filter(([userId, state]) => {
          if (userId === this.currentUserId) return false;
          
          const shouldHaveVideo = state.isVideoOn || state.isScreenSharing;
          const shouldHaveAudio = !state.isMuted;
          
          return shouldHaveVideo || shouldHaveAudio;
        });
      
      if (participantsWithTracks.length === 0) {
        return;
      }
      
      
      // For each existing participant, trigger track sending
      for (const [userId, state] of participantsWithTracks) {
        try {
          await this.forceParticipantToSendTracks(userId, state);
        } catch (error) {
        }
      }
    } finally {
      this.forceTrackSendingInProgress = false;
    }
  }
  
  // ✅ NEW: Force a specific participant to send their tracks
  private async forceParticipantToSendTracks(userId: string, state: any) {
    
    const pc = this.peerConnections.get(userId);
    if (!pc) {
      return;
    }

    // Check if peer connection is in a valid state
    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      return;
    }

    // Check if we're already in the middle of a renegotiation
    if (pc.signalingState !== 'stable') {
      return;
    }

    // Debounce renegotiation attempts
    const existingTimer = this.negotiationTimers.get(userId);
    if (existingTimer) {
      return;
    }

    // Set debounce timer
    const timer = setTimeout(async () => {
      this.negotiationTimers.delete(userId);
      await this.performRenegotiation(userId);
    }, this.negotiationDebounceMs);
    
    this.negotiationTimers.set(userId, timer);
  }

  // ✅ NEW: Perform actual renegotiation
  private async performRenegotiation(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) {
      return;
    }

    // Double-check state before proceeding
    if (pc.signalingState !== 'stable') {
      return;
    }

    
    try {
      // Create and send an offer to trigger renegotiation
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await this.signalr.invoke('SendOffer', this.roomKey, {
        targetUserId: userId,
        offer: offer
      });
      
    } catch (error) {
    }
  }
  
  // ✅ NEW: Force existing participants to send their tracks to a specific new joiner
  private async forceExistingParticipantsToSendTracksToSpecificUser(targetUserId: string) {
    
    // Get all participants who should have video/audio and send their tracks to the target user
    const participantsWithTracks = Array.from(this.participantStatesVersioned.entries())
      .filter(([userId, state]) => {
        if (userId === this.currentUserId) return false; // Skip current user
        if (userId === targetUserId) return false; // Skip target user
        
        const shouldHaveVideo = state.isVideoOn || state.isScreenSharing;
        const shouldHaveAudio = !state.isMuted;
        
        return shouldHaveVideo || shouldHaveAudio;
      });
    
    if (participantsWithTracks.length === 0) {
      return;
    }
    
    
    // For each existing participant, trigger track sending to the target user
    for (const [userId, state] of participantsWithTracks) {
      try {
        await this.forceParticipantToSendTracksToSpecificUser(userId, state, targetUserId);
      } catch (error) {
      }
    }
  }
  
  // ✅ NEW: Force track sending for rejoin scenarios - key fix for video visibility
  private async forceTrackSendingForRejoinScenarios() {
    
    // Get all participants who should have video/audio
    const participantsWithTracks = Array.from(this.participantStatesVersioned.entries())
      .filter(([userId, state]) => {
        if (userId === this.currentUserId) return false;
        
        const shouldHaveVideo = state.isVideoOn || state.isScreenSharing;
        const shouldHaveAudio = !state.isMuted;
        
        return shouldHaveVideo || shouldHaveAudio;
      });
    
    if (participantsWithTracks.length === 0) {
      return;
    }
    
    
    // Force track sending for each participant
    for (const [userId, state] of participantsWithTracks) {
      try {
        await this.forceParticipantToSendTracks(userId, state);
        
        // Additional renegotiation to ensure tracks are sent
        const pc = this.peerConnections.get(userId);
        if (pc && pc.connectionState === 'connected') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await this.signalr.invoke('SendOffer', this.roomKey, {
            targetUserId: userId,
            offer: offer
          });
        }
      } catch (error) {
      }
    }
    
    // ✅ DEBUG: Log current state for troubleshooting
  }
  
  // ✅ NEW: Force a specific participant to send their tracks to a specific target user
  private async forceParticipantToSendTracksToSpecificUser(senderUserId: string, senderState: any, targetUserId: string) {
    
    // ✅ ENHANCED: Prevent concurrent renegotiations for same peer connection
    const renegotiationKey = `renegotiation-${targetUserId}`;
    if (this.trackSendingInProgress.has(renegotiationKey)) {
      return;
    }
    
    this.trackSendingInProgress.add(renegotiationKey);
    
    try {
      const pc = this.peerConnections.get(targetUserId);
      if (!pc) {
        return;
      }

      // Check if peer connection is in a valid state
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        return;
      }

      // ✅ ENHANCED: Single renegotiation attempt to prevent conflicts
      try {
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.signalr.invoke('SendOffer', this.roomKey, {
          targetUserId: targetUserId,
          offer: offer
        });
        
      } catch (error) {
      }
    } finally {
      // Remove from in-progress set after a delay
      setTimeout(() => {
        this.trackSendingInProgress.delete(renegotiationKey);
      }, 2000);
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
    
    // ✅ FIXED: Force change detection for remote participant state changes
    this.cdr.markForCheck();
  }
  
  // ✅ ENHANCED: Handle track-ready event with better logging and state management
  private handleParticipantTrackReady(data: any) {
    const userId = data.userId;
    const versionedState = this.participantStatesVersioned.get(userId);
    if (!versionedState) {
      return;
    }
    
    
    // Update track arrival flags
    if (data.hasVideo) {
      versionedState.videoTrackArrived = true;
      // If state says video is on and track is now ready, update status
      if (versionedState.isVideoOn) {
        versionedState.videoStatus = 'on';
        
        // Update participant service to show video
        this.updateParticipantStateUnified(userId, { isVideoOn: true });
      }
    }
    
    if (data.hasAudio) {
      versionedState.audioTrackArrived = true;
    }
    
    // ✅ FIXED: Always update participant state when track arrives, regardless of current state
    // This fixes the rejoin scenario where participant should have video but state is not properly set
    if (data.hasVideo && versionedState.isVideoOn) {
      this.updateParticipantStateUnified(userId, { isVideoOn: true });
    }
    
    this.participantStatesVersioned.set(userId, versionedState);
    
    // ✅ ENHANCED: Force immediate change detection and video element update
    this.cdr.markForCheck();
    // ✅ REACTIVE: No manual change detection needed - reactive streams handle UI updates
    
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

  // ✅ REACTIVE: Atomic state update method with reactive streams
  private updateParticipantStateUnified(userId: string, updates: Partial<Participant>) {
    const currentStates = this.participantStatesSubject.value;
    const currentState = currentStates.get(userId);
    if (!currentState) {
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
    
    // ✅ REACTIVE: Update reactive stream - automatically triggers change detection
    const newStates = new Map(currentStates);
    newStates.set(userId, newState);
    this.participantStatesSubject.next(newStates);
    
    // Update participant service for backward compatibility
    this.participantService.updateParticipantState(userId, updates);
    
    // ✅ FIXED: Force change detection after participant state update
    this.cdr.markForCheck();
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
      
      // ✅ FIXED: Force change detection after state broadcast
      this.cdr.markForCheck();
    } catch (error) {
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
      
      // ✅ ENHANCED: Immediate camera cleanup before leaving
      await this.cleanupCameraResources();
      
      // Notify backend to end the meeting (only if host)
      if (this.isHost) {
        await this.signalr.invoke('EndMeeting', this.roomKey);
      }
      await this.signalr.leaveRoom(this.roomKey);
      await this.cleanup();
      
      // Clear meeting status completely (real exit)
      this.meetingStatus.leaveMeeting();
      
      this.router.navigate(['/meetings']);
    } catch (error) {
      // Even if there's an error, ensure camera is cleaned up
      try {
        await this.cleanupCameraResources();
      } catch (cleanupError) {
        // Ignore cleanup errors during error handling
      }
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
      
      // ✅ REACTIVE: No change detection timeout to clear - reactive streams handle updates

      // ✅ ENHANCED: Cleanup all peer connections with proper await
      const userIds = Array.from(this.peerConnections.keys());
      await Promise.all(userIds.map(userId => this.cleanupPeerConnection(userId)));
      
      // ✅ ENHANCED: Clear all state to prevent stale data on rejoin
      this.participantStatesVersioned.clear();
      this.processedIceCandidates.clear();
      this.makingOffer.clear();
      this.politeMap.clear();
      
      // ✅ REACTIVE: Reset meeting state through reactive stream
      this.meetingStateSubject.next({
        isMuted: false,
        isVideoOn: false,
        isScreenSharing: false,
        isWhiteboardActive: false
      });
      
      this.wasVideoOnBeforeShare = false;
      this.connected = false;
      
      // ✅ NEW: Reset track sending flag
      this.forceTrackSendingInProgress = false;
      
      // Clear all timers
      this.negotiationTimers.forEach(timer => clearTimeout(timer));
      this.negotiationTimers.clear();
      
      // ✅ ENHANCED: Comprehensive camera cleanup to ensure LED turns off
      await this.cleanupCameraResources();
      
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
      
    } catch (error) {
    }
  }

  // ✅ NEW: Comprehensive camera cleanup to ensure LED turns off
  private async cleanupCameraResources() {
    try {
      // Stop all local media tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            track.stop(); // This will turn off camera LED
          } catch (error) {
            // Track might already be stopped
          }
        });
        this.localStreamSubject.next(undefined);
      }
      
      if (this.rawLocalStream) {
        this.rawLocalStream.getTracks().forEach(track => {
          try { 
            track.stop(); // This will turn off camera LED
          } catch (error) {
            // Track might already be stopped
          }
        });
        this.rawLocalStream = undefined;
      }

      // Stop video effects processing
      try { 
        this.videoEffects.stop(); 
      } catch (error) {
        // Video effects might already be stopped
      }

      // Clear all video elements
      this.clearAllVideoElements();
      
      // Force garbage collection of media streams
      this.localStreamSubject.next(undefined);
      
      // Additional cleanup for stubborn camera resources
      try {
        // Get all media devices and stop any active tracks
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        // Force stop any remaining video tracks
        for (const device of videoDevices) {
          try {
            // This is a fallback to ensure camera is released
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { deviceId: { exact: device.deviceId } } 
            });
            stream.getTracks().forEach(track => {
              track.stop();
            });
          } catch (error) {
            // Device might not be accessible, which is fine
          }
        }
      } catch (error) {
        // Device enumeration might fail, which is acceptable
      }
      
    } catch (error) {
      // Camera cleanup error - log but don't throw
    }
  }

  // ✅ ENHANCED: Comprehensive cleanup method for peer connection
  private async cleanupPeerConnection(userId: string) {
    
    // 1. Close peer connection gracefully
    const pc = this.peerConnections.get(userId);
    if (pc) {
      try {
        // Close all transceivers first
        pc.getTransceivers().forEach(transceiver => {
          try {
            transceiver.stop();
          } catch (error) {
          }
        });
        
        // Close peer connection
        pc.close();
      } catch (error) {
      }
    }
    
    // 2. Clear remote stream and stop all tracks
    const remoteStream = this.remoteStreams.get(userId);
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (error) {
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
    
  }

  // ✅ REACTIVE: Removed manual change detection - reactive streams handle UI updates automatically
  // All state changes now go through BehaviorSubjects which automatically trigger change detection
  // when subscribed to in templates via async pipes or direct subscriptions

  private async processPendingIceCandidates(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    const pendingCandidates = this.pendingIceCandidates.get(userId);
    if (pendingCandidates && pendingCandidates.length > 0) {
      for (const candidate of pendingCandidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
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

  // ===== Audio settings change handler =====
  private async handleAudioSettingsChange(): Promise<void> {
    try {
      if (!this.localStream) return;
      
      const deviceSettings = this.settingsService.deviceSettings();
      const audioTrack = this.localStream.getAudioTracks()[0];
      
      if (audioTrack) {
        // Apply microphone volume changes
        this.applyMicrophoneVolume(audioTrack);
      }
      
      // Re-setup audio analysis with new volume settings
      this.setupAudioAnalysisForStream(this.currentUserId, this.localStream);
      
    } catch (error) {
    }
  }

  // ===== Audio volume control =====
  private applyMicrophoneVolume(audioTrack: MediaStreamTrack): void {
    try {
      const deviceSettings = this.settingsService.deviceSettings();
      const volume = deviceSettings.microphoneVolume;
      
      // Volume is now applied in setupAudioAnalysisForStream via gain node
    } catch (error) {
    }
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
      
      // ✅ FIXED: Add gain node for volume control
      const gainNode = this.audioContext.createGain();
      
      // Apply volume from settings if this is local user
      if (userId === this.currentUserId) {
        const deviceSettings = this.settingsService.deviceSettings();
        const volume = deviceSettings.microphoneVolume;
        // Map 0-100 to 0.0-1.0 (normal), 50-100 to 1.0-1.5 (boost)
        let gainValue: number;
        if (volume <= 50) {
          gainValue = (volume / 50); // 0..1
        } else {
          const over = (volume - 50) / 50; // 0..1
          gainValue = 1 + over * 0.5; // 1..1.5
        }
        gainValue = Math.min(gainValue, 1.5); // safety cap
        gainNode.gain.value = gainValue;
      } else {
        gainNode.gain.value = 1.0; // Default for remote users
      }
      
      // Connect: src -> gain -> analyser
      src.connect(gainNode);
      gainNode.connect(analyser);

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
        } catch (error) {
        }
      }
      
      if (src) {
        try { 
          src.disconnect();
        } catch (error) {
        }
      }
    } catch (error) {
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
        if ((topUser !== lastUserId && (now - lastSwitchAt) > minHoldMs) || !this.activeSpeakerSubject.value) {
          lastUserId = topUser;
          lastSwitchAt = now;
          if (this.activeSpeakerSubject.value !== topUser) {
            // ✅ REACTIVE: Update active speaker through reactive stream
            this.activeSpeakerSubject.next(topUser);
            
            // ✅ REACTIVE: Update meeting state with active speaker
            const currentMeetingState = this.meetingStateSubject.value;
            this.meetingStateSubject.next({
              ...currentMeetingState,
              activeSpeaker: topUser
            });
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