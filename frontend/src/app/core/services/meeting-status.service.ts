import { Injectable, signal } from '@angular/core';

export interface ActiveMeeting {
  meetingId: string;
  roomKey: string;
  title: string;
  isHost: boolean;
  joinedAt: Date;
  isBackground: boolean; // Yeni: Arka planda mı?
  // Meeting state preservation
  meetingState?: {
    isMuted: boolean;
    isVideoOn: boolean;
    isScreenSharing: boolean;
    isWhiteboardActive: boolean;
  };
  // SignalR connection state
  wasConnected: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class MeetingStatusService {
  private activeMeeting = signal<ActiveMeeting | null>(null);

  get currentMeeting() {
    return this.activeMeeting.asReadonly();
  }

  get hasActiveMeeting(): boolean {
    return this.activeMeeting() !== null;
  }

  joinMeeting(meetingId: string, roomKey: string, title: string, isHost: boolean) {
    this.activeMeeting.set({
      meetingId,
      roomKey,
      title,
      isHost,
      joinedAt: new Date(),
      isBackground: false,
      wasConnected: true
    });
  }

  updateMeetingState(meetingState: {
    isMuted: boolean;
    isVideoOn: boolean;
    isScreenSharing: boolean;
    isWhiteboardActive: boolean;
  }) {
    const current = this.activeMeeting();
    if (current) {
      this.activeMeeting.set({
        ...current,
        meetingState
      });
    }
  }

  setBackgroundMode(isBackground: boolean) {
    const current = this.activeMeeting();
    if (current) {
      this.activeMeeting.set({
        ...current,
        isBackground
      });
    }
  }

  leaveMeeting() {
    this.activeMeeting.set(null);
  }

  getMeetingReturnUrl(): string {
    const meeting = this.activeMeeting();
    if (!meeting) return '';
    return `/meetings/${meeting.meetingId}`;
  }
}
