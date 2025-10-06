import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Participant } from '../meeting-room';

@Injectable({
  providedIn: 'root'
})
export class ParticipantService {
  private participantsSubject = new BehaviorSubject<Participant[]>([]);
  public participants$ = this.participantsSubject.asObservable();

  private participants: Participant[] = [];

  constructor() {}

  getParticipants(): Participant[] {
    return this.participants;
  }

  setParticipants(participants: Participant[]): void {
    // Avoid emitting if nothing changed (shallow compare by length and ids)
    const sameLength = this.participants.length === participants.length;
    const sameIds = sameLength && this.participants.every((p, i) => p.userId === participants[i].userId);
    if (sameLength && sameIds) {
      this.participants = participants;
      return;
    }
    this.participants = participants;
    this.participantsSubject.next(this.participants);
  }

  updateParticipantState(userId: string, updates: Partial<Participant>): void {
    const index = this.participants.findIndex(p => p.userId === userId);
    if (index !== -1) {
      const current = this.participants[index];
      const next = { ...current, ...updates } as Participant;
      // Avoid redundant emits if nothing changed
      const noChange =
        current.isVideoOn === next.isVideoOn &&
        current.isMuted === next.isMuted &&
        current.isScreenSharing === next.isScreenSharing &&
        current.isWhiteboardEnabled === next.isWhiteboardEnabled;
      this.participants[index] = next;
      if (!noChange) {
        // Emit only when actual state changed
        this.participantsSubject.next([...this.participants]);
      }
      
      console.log(`🔥 ParticipantService: ${userId} updated:`, updates);
    } else {
      console.warn(`🔥 ParticipantService: Participant ${userId} not found in participants list`);
      console.log(`   Current participants:`, this.participants.map(p => p.userId));
    }
  }

  updateVideoState(userId: string, isVideoOn: boolean): void {
    this.updateParticipantState(userId, { isVideoOn });
  }

  updateMuteState(userId: string, isMuted: boolean): void {
    this.updateParticipantState(userId, { isMuted });
  }

  updateScreenShareState(userId: string, isScreenSharing: boolean): void {
    this.updateParticipantState(userId, { isScreenSharing });
  }

  addParticipant(participant: Participant): void {
    const existingIndex = this.participants.findIndex(p => p.userId === participant.userId);
    if (existingIndex !== -1) {
      this.participants[existingIndex] = participant;
    } else {
      this.participants.push(participant);
    }
    this.participantsSubject.next([...this.participants]);
  }

  removeParticipant(userId: string): void {
    this.participants = this.participants.filter(p => p.userId !== userId);
    this.participantsSubject.next([...this.participants]);
  }

  getParticipant(userId: string): Participant | undefined {
    return this.participants.find(p => p.userId === userId);
  }
}
