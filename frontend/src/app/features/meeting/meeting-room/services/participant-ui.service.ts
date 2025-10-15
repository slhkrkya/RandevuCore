import { Injectable } from '@angular/core';
import { Participant } from '../meeting-room';

@Injectable({
  providedIn: 'root'
})
export class ParticipantUIService {

  constructor() { }

  // ✅ UNIFIED: Participant background color with consistent scheme
  getParticipantBackgroundColor(participant: Participant): string {
    const colors = [
      'bg-gradient-to-br from-blue-400 to-blue-600',
      'bg-gradient-to-br from-green-400 to-green-600',
      'bg-gradient-to-br from-purple-400 to-purple-600',
      'bg-gradient-to-br from-pink-400 to-pink-600',
      'bg-gradient-to-br from-indigo-400 to-indigo-600',
      'bg-gradient-to-br from-red-400 to-red-600',
      'bg-gradient-to-br from-yellow-400 to-yellow-600',
      'bg-gradient-to-br from-teal-400 to-teal-600',
      'bg-gradient-to-br from-orange-400 to-orange-600',
      'bg-gradient-to-br from-cyan-400 to-cyan-600',
      'bg-gradient-to-br from-violet-400 to-violet-600',
      'bg-gradient-to-br from-emerald-400 to-emerald-600'
    ];
    
    const index = participant.userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  }

  // ✅ UNIFIED: Participant initials generation
  getParticipantInitials(participant: Participant): string {
    const names = participant.name.split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[1][0]).toUpperCase();
    }
    return participant.name.substring(0, 2).toUpperCase();
  }

  // ✅ UNIFIED: Participant display name
  getParticipantDisplayName(participant: Participant, currentUserId: string): string {
    if (participant.userId === currentUserId) {
      return 'You';
    }
    return participant.name || 'Unknown User';
  }

  // ✅ UNIFIED: Participant status text
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
}
