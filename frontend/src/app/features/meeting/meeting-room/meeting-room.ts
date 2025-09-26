import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SignalRService } from '../../../core/services/signalr';
import { VideoGridComponent } from './video-grid/video-grid';
import { SpeakerViewComponent } from './speaker-view/speaker-view';
import { WhiteboardComponent } from './whiteboard/whiteboard';
import { MeetingControlsComponent } from './meeting-controls/meeting-controls';
import { ParticipantsPanelComponent } from './participants-panel/participants-panel';
import { ChatPanelComponent } from './chat-panel/chat-panel';

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
  localStream?: MediaStream;
  remoteStreams: Map<string, MediaStream> = new Map();
  peerConnections: Map<string, RTCPeerConnection> = new Map();

  // UI state
  showParticipantsPanel = false;
  showChatPanel = false;
  showWhiteboardPanel = false;
  isFullscreen = false;
  activeView: 'grid' | 'speaker' | 'whiteboard' = 'grid';

  // ViewChild references
  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo', { static: true }) remoteVideo!: ElementRef<HTMLVideoElement>;

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    public signalr: SignalRService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.initializeMeeting();
    this.setupSignalRListeners();
    await this.initializeMedia();
  }

  async ngOnDestroy() {
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
    } catch (error) {
      console.error('Error parsing token:', error);
      this.router.navigate(['/login']);
      return;
    }

    // Connect to SignalR
    await this.signalr.start(token);
    await this.signalr.joinRoom(this.roomKey);
    this.connected = true;

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
    this.signalr.on<any>('permission-granted', async (permission) => {
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

      // Get user media
      await this.ensureLocalStream();
    } catch (error) {
      console.error('Error initializing media:', error);
    }
  }

  private async ensureLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    const constraints: MediaStreamConstraints = {
      video: true,
      audio: true
    };

    // Add device preferences
    const preferredCamera = localStorage.getItem('preferredCamera');
    const preferredMicrophone = localStorage.getItem('preferredMicrophone');
    
    if (preferredCamera) {
      (constraints.video as any) = { deviceId: { exact: preferredCamera } };
    }
    if (preferredMicrophone) {
      (constraints.audio as any) = { deviceId: { exact: preferredMicrophone } };
    }

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Set track states
    if (this.localStream.getVideoTracks()[0]) {
      this.localStream.getVideoTracks()[0].enabled = this.meetingState.isVideoOn;
    }
    if (this.localStream.getAudioTracks()[0]) {
      this.localStream.getAudioTracks()[0].enabled = !this.meetingState.isMuted;
    }
    
    // Update local video element
    if (this.localVideo) {
      this.localVideo.nativeElement.srcObject = this.localStream;
    }
    
    // Update all peer connections
    this.updateAllPeerConnections();
    
    // Send offers to any participants who don't have connections yet
    this.sendOffersToNewParticipants();
  }

  private updateAllPeerConnections() {
    if (!this.localStream) return;

    // Batch renegotiation to avoid multiple simultaneous offers
    const renegotiationPromises: Promise<void>[] = [];

    this.peerConnections.forEach((pc, userId) => {
      // Remove existing tracks
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          pc.removeTrack(sender);
        }
      });
      
      // Add new tracks
      this.localStream!.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
      
      // Queue renegotiation
      renegotiationPromises.push(this.renegotiateConnection(userId));
    });

    // Execute all renegotiations in parallel
    Promise.all(renegotiationPromises).catch(error => {
      console.error('Error during batch renegotiation:', error);
    });
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

    for (const participant of this.participants) {
      if (participant.userId !== this.currentUserId && !this.peerConnections.has(participant.userId)) {
        await this.createPeerConnection(participant.userId);
        await this.sendOffer(participant.userId);
      }
    }
  }

  private updateParticipantStateFromTracks(userId: string, stream: MediaStream) {
    const participant = this.participants.find(p => p.userId === userId);
    if (!participant) return;

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    // Update participant state based on actual track states
    if (videoTrack) {
      participant.isVideoOn = videoTrack.enabled;
    }

    if (audioTrack) {
      participant.isMuted = !audioTrack.enabled;
    }

    // Check if it's screen sharing (screen track has different label)
    if (videoTrack && videoTrack.label.includes('screen')) {
      participant.isScreenSharing = true;
    }
  }

  // Meeting controls
  async toggleMute() {
    this.meetingState.isMuted = !this.meetingState.isMuted;
    
    if (this.localStream && this.localStream.getAudioTracks()[0]) {
      this.localStream.getAudioTracks()[0].enabled = !this.meetingState.isMuted;
    }

    // Update participant state
    const currentParticipant = this.participants.find(p => p.userId === this.currentUserId);
    if (currentParticipant) {
      currentParticipant.isMuted = this.meetingState.isMuted;
    }

    // Broadcast state change
    await this.broadcastStateChange();
    this.triggerChangeDetection();
  }

  async toggleVideo() {
    this.meetingState.isVideoOn = !this.meetingState.isVideoOn;
    
    if (this.localStream && this.localStream.getVideoTracks()[0]) {
      this.localStream.getVideoTracks()[0].enabled = this.meetingState.isVideoOn;
    }

    // Update local video visibility
    if (this.localVideo) {
      this.localVideo.nativeElement.style.display = this.meetingState.isVideoOn ? 'block' : 'none';
    }

    // Update participant state
    const currentParticipant = this.participants.find(p => p.userId === this.currentUserId);
    if (currentParticipant) {
      currentParticipant.isVideoOn = this.meetingState.isVideoOn;
    }

    // Broadcast state change
    await this.broadcastStateChange();
    this.triggerChangeDetection();
  }

  async toggleScreenShare() {
    if (this.meetingState.isScreenSharing) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare();
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
      
      // Update participant state
      const currentParticipant = this.participants.find(p => p.userId === this.currentUserId);
      if (currentParticipant) {
        currentParticipant.isScreenSharing = true;
      }

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
    
    // Update participant state
    const currentParticipant = this.participants.find(p => p.userId === this.currentUserId);
    if (currentParticipant) {
      currentParticipant.isScreenSharing = false;
    }

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
    this.participants = participants.map(p => ({
      ...p,
      isVideoOn: p.isVideoOn ?? false,
      isMuted: p.isMuted ?? false,
      isScreenSharing: p.isScreenSharing ?? false,
      isWhiteboardEnabled: p.isWhiteboardEnabled ?? false
    }));
    
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
      }
    }
    
    this.triggerChangeDetection();
  }

  private async createPeerConnection(userId: string) {
    const pc = new RTCPeerConnection({ 
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalr.sendToRoom(this.roomKey, 'webrtc-ice', { 
          candidate: event.candidate, 
          targetUserId: userId 
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      this.remoteStreams.set(userId, stream);
      
      // Update participant state based on received tracks
      this.updateParticipantStateFromTracks(userId, stream);
      
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

    // Add local tracks to the peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    }
  }

  private async handleMeetingStateUpdate(state: any) {
    // Handle meeting state updates from other participants
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
      await this.signalr.leaveRoom(this.roomKey);
      await this.cleanup();
      this.router.navigate(['/meetings']);
    } catch (error) {
      console.error('Error ending meeting:', error);
      this.router.navigate(['/meetings']);
    }
  }

  private async cleanup() {
      // Close all peer connections
      this.peerConnections.forEach(pc => pc.close());
      this.peerConnections.clear();
      this.remoteStreams.clear();
      
      // Stop local media tracks
      this.localStream?.getTracks().forEach(track => track.stop());
      this.localStream = undefined;
  }

  private changeDetectionTimeout: any = null;

  triggerChangeDetection() {
    // Use setTimeout to avoid excessive change detection cycles
    if (!this.changeDetectionTimeout) {
      this.changeDetectionTimeout = setTimeout(() => {
    this.cdr.detectChanges();
        this.changeDetectionTimeout = null;
      }, 0);
    }
  }
}
