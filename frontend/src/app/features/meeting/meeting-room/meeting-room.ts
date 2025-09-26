import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SignalRService } from '../../../core/services/signalr';

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meeting-room.html',
  styleUrls: ['./meeting-room.css']
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  meetingId = '';
  connected = false;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  roomKey = '';
  private screenSender?: RTCRtpSender;
  private camSender?: RTCRtpSender;
  private prevCamTrack?: MediaStreamTrack;
  isCamOn = false;
  isMicOn = false;
  isSharing = false;
  // drag state for local thumbnail
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private originX = 0;
  private originY = 0;
  dragX = 0;
  dragY = 0;

  @ViewChild('localVideo', { static: true }) localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo', { static: true }) remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('board', { static: true }) board!: ElementRef<HTMLCanvasElement>;
  private boardCtx?: CanvasRenderingContext2D | null;
  private drawing = false;
  participants: Array<{ connectionId: string; userId: string; name: string }> = [];
  currentUserId = '';
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();

  constructor(private route: ActivatedRoute, public signalr: SignalRService) {}

  async ngOnInit() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    this.roomKey = `meeting-${this.meetingId}`;
    const token = localStorage.getItem('token') || '';
    await this.signalr.start(token);
    await this.signalr.joinRoom(this.roomKey);
    this.connected = true;
    // get current user id from token payload (decoded base64)
    try {
      const payload = JSON.parse(atob((localStorage.getItem('token') || '').split('.')[1] || ''));
      this.currentUserId = payload.sub;
    } catch {}

    // setup signaling listeners
    this.signalr.on<any>('webrtc-offer', async payload => {
      await this.handleOffer(payload);
    });

    this.signalr.on<any>('webrtc-answer', async payload => {
      await this.handleAnswer(payload);
    });

    this.signalr.on<any>('webrtc-ice', async payload => {
      await this.handleIceCandidate(payload);
    });

    // whiteboard events
    this.signalr.on<any>('wb-draw', (p) => this.drawRemote(p));

    // presence and permissions
    this.signalr.on<any>('presence', list => { 
      this.participants = list; 
      this.handlePresenceUpdate(list);
    });
    this.signalr.on<any>('perm-granted', async (p) => {
      if (p.targetUserId === this.currentUserId) {
        switch (p.permission) {
          case 'cam': await this.toggleCamera(); break;
          case 'mic': await this.toggleMic(); break;
          case 'screen': await this.shareScreen(); break;
        }
      }
    });

    // init board
    this.boardCtx = this.board.nativeElement.getContext('2d');
    this.board.nativeElement.width = 800;
    this.board.nativeElement.height = 500;
  }

  async ngOnDestroy() {
    await this.signalr.leaveRoom(this.roomKey);
    // Close all peer connections
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
  }

  async toggleCamera() {
    await this.ensureLocalStream();
    const v = this.localStream!.getVideoTracks()[0];
    if (v) {
      v.enabled = !v.enabled;
      this.isCamOn = v.enabled;
    }
  }

  async shareScreen() {
    await this.ensureLocalStream();
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
    const screenTrack = stream.getVideoTracks()[0];
    this.prevCamTrack = this.localStream!.getVideoTracks()[0];
    
    // Replace track in all peer connections
    this.peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      sender?.replaceTrack(screenTrack);
    });
    
    this.isSharing = true;
    screenTrack.onended = async () => {
      try {
        if (this.prevCamTrack) {
          this.peerConnections.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            sender?.replaceTrack(this.prevCamTrack!);
          });
        }
      } finally {
        this.isSharing = false;
      }
    };
  }

  private async renegotiate() {
    // Send offers to all connected peers
    for (const [userId, pc] of this.peerConnections) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signalr.sendToRoom(this.roomKey, 'webrtc-offer', { 
        sdp: pc.localDescription, 
        targetUserId: userId 
      });
    }
  }

  private async ensureLocalStream() {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localVideo.nativeElement.srcObject = this.localStream;
      // default states
      this.isCamOn = this.localStream.getVideoTracks()[0]?.enabled ?? false;
      this.isMicOn = this.localStream.getAudioTracks()[0]?.enabled ?? false;
    }
  }

  async toggleMic() {
    await this.ensureLocalStream();
    const a = this.localStream!.getAudioTracks()[0];
    if (a) {
      a.enabled = !a.enabled;
      this.isMicOn = a.enabled;
    }
  }

  // drag handlers for local video thumbnail
  onLocalDown(ev: MouseEvent) {
    this.dragging = true;
    this.startX = ev.clientX;
    this.startY = ev.clientY;
    this.originX = this.dragX;
    this.originY = this.dragY;
    window.addEventListener('mousemove', this.onLocalMove);
    window.addEventListener('mouseup', this.onLocalUp);
  }

  onLocalMove = (ev: MouseEvent) => {
    if (!this.dragging) return;
    this.dragX = this.originX + (ev.clientX - this.startX);
    this.dragY = this.originY + (ev.clientY - this.startY);
  }

  onLocalUp = () => {
    this.dragging = false;
    window.removeEventListener('mousemove', this.onLocalMove);
    window.removeEventListener('mouseup', this.onLocalUp);
  }

  onBoardMouseDown(e: MouseEvent) {
    this.drawing = true;
    const p = this.pos(e);
    this.drawLocal(p, true);
    this.signalr.sendToRoom(this.roomKey, 'wb-draw', { x: p.x, y: p.y, start: true });
  }

  onBoardMouseMove(e: MouseEvent) {
    if (!this.drawing) return;
    const p = this.pos(e);
    this.drawLocal(p, false);
    this.signalr.sendToRoom(this.roomKey, 'wb-draw', { x: p.x, y: p.y, start: false });
  }

  onBoardMouseUp() { this.drawing = false; }

  private pos(e: MouseEvent) {
    const rect = this.board.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private drawLocal(p: { x: number; y: number }, start: boolean) {
    if (!this.boardCtx) return;
    this.boardCtx.strokeStyle = '#111827';
    this.boardCtx.lineWidth = 2;
    if (start) this.boardCtx.beginPath();
    this.boardCtx.lineTo(p.x, p.y);
    this.boardCtx.stroke();
  }

  private drawRemote(p: any) {
    if (!this.boardCtx) return;
    if (p.start) this.boardCtx.beginPath();
    this.boardCtx.lineTo(p.x, p.y);
    this.boardCtx.stroke();
  }

  private async handlePresenceUpdate(participants: Array<{ connectionId: string; userId: string; name: string }>) {
    // Create connections for new participants
    for (const participant of participants) {
      if (participant.userId !== this.currentUserId && !this.peerConnections.has(participant.userId)) {
        await this.createPeerConnection(participant.userId);
        // Send offer to new participant
        await this.sendOffer(participant.userId);
      }
    }

    // Remove connections for participants who left
    const currentParticipantIds = new Set(participants.map(p => p.userId));
    for (const [userId, pc] of this.peerConnections) {
      if (!currentParticipantIds.has(userId)) {
        pc.close();
        this.peerConnections.delete(userId);
        this.remoteStreams.delete(userId);
      }
    }
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
      // Update the main remote video with the latest stream
      this.remoteStream = stream;
      this.remoteVideo.nativeElement.srcObject = stream;
    };

    this.peerConnections.set(userId, pc);
    return pc;
  }

  private async sendOffer(userId: string) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    await this.ensureLocalStream();
    this.localStream!.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream!);
    });

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

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    await this.signalr.sendToRoom(this.roomKey, 'webrtc-answer', { 
      sdp: pc.localDescription, 
      targetUserId: fromUserId 
    });
  }

  private async handleAnswer(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { sdp, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  private async handleIceCandidate(payload: any) {
    const { fromUserId, payload: data } = payload;
    const { candidate, targetUserId } = data;
    if (targetUserId !== this.currentUserId) return;

    const pc = this.peerConnections.get(fromUserId);
    if (pc && candidate) {
      await pc.addIceCandidate(candidate);
    }
  }
}


