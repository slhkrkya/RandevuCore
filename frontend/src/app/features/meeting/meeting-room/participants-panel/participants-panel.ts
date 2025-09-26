import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Participant } from '../meeting-room';

@Component({
  selector: 'app-participants-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './participants-panel.html',
  styleUrls: ['./participants-panel.css']
})
export class ParticipantsPanelComponent {
  @Input() participants: Participant[] = [];
  @Input() currentUserId = '';
  @Input() isHost = false;

  @Output() grantPermission = new EventEmitter<{ userId: string; permission: string }>();
  @Output() removeParticipant = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

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

  getParticipantDisplayName(participant: Participant): string {
    if (participant.userId === this.currentUserId) {
      return 'You';
    }
    return participant.name;
  }

  getParticipantStatus(participant: Participant): string {
    const statuses = [];
    
    if (participant.isMuted) {
      statuses.push('Muted');
    }
    
    if (!participant.isVideoOn) {
      statuses.push('Camera Off');
    }
    
    if (participant.isScreenSharing) {
      statuses.push('Sharing Screen');
    }
    
    if (participant.isHost) {
      statuses.push('Host');
    }
    
    return statuses.join(' • ');
  }

  onGrantPermission(userId: string, permission: string) {
    this.grantPermission.emit({ userId, permission });
  }

  onRemoveParticipant(userId: string) {
    this.removeParticipant.emit(userId);
  }

  onClose() {
    this.close.emit();
  }
}
