import { Component, Input, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Participant, MeetingState } from '../meeting-room';

@Component({
  selector: 'app-speaker-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speaker-view.html',
  styleUrls: ['./speaker-view.css']
})
export class SpeakerViewComponent {
  @Input() participants: Participant[] = [];
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream;
  @Input() remoteStreams: Map<string, MediaStream> = new Map();
  @Input() meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };

  @ViewChild('mainVideo', { static: true }) mainVideo!: ElementRef<HTMLVideoElement>;

  constructor(private cdr: ChangeDetectorRef) {}

  getActiveSpeaker(): Participant | null {
    // Find the participant who is currently speaking
    if (this.meetingState.activeSpeaker) {
      return this.participants.find(p => p.userId === this.meetingState.activeSpeaker) || null;
    }
    
    // Default to first participant with video
    return this.participants.find(p => p.isVideoOn) || this.participants[0] || null;
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
    return this.participants.filter(p => p.userId !== activeSpeaker?.userId);
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
      return this.meetingState.isVideoOn;
    }
    return participant.isVideoOn;
  }

  getParticipantDisplayName(participant: Participant): string {
    if (participant.userId === this.currentUserId) {
      return 'You';
    }
    return participant.name;
  }
}
