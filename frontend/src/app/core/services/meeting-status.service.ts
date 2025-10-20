import { Injectable, signal } from '@angular/core';

export interface ActiveMeeting {
  meetingId: string;
  roomKey: string;
  title: string;
  isHost: boolean;
  joinedAt: Date;
  isBackground: boolean; // Yeni: Arka planda mı?
  isEnded: boolean; // Yeni: Toplantı bitirildi mi?
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

  private static STORAGE_KEY = 'activeMeeting';

  constructor() {
    // Restore last active meeting (including in-room state) across reloads in the same tab
    try {
      const raw = sessionStorage.getItem(MeetingStatusService.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ActiveMeeting;
        // Revive dates
        if (parsed && (parsed as any).joinedAt) {
          (parsed as any).joinedAt = new Date((parsed as any).joinedAt);
        }
        this.activeMeeting.set(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }

  get currentMeeting() {
    return this.activeMeeting.asReadonly();
  }

  get hasActiveMeeting(): boolean {
    const meeting = this.activeMeeting();
    return meeting !== null && !meeting.isEnded;
  }

  joinMeeting(meetingId: string, roomKey: string, title: string, isHost: boolean) {
    this.activeMeeting.set({
      meetingId,
      roomKey,
      title,
      isHost,
      joinedAt: new Date(),
      isBackground: false,
      isEnded: false,
      wasConnected: true
    });
    this.saveToStorage();
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
      this.saveToStorage();
    }
  }

  setBackgroundMode(isBackground: boolean) {
    const current = this.activeMeeting();
    if (current) {
      this.activeMeeting.set({
        ...current,
        isBackground
      });
      this.saveToStorage();
    }
  }

  endMeeting() {
    const current = this.activeMeeting();
    if (current) {
      this.activeMeeting.set({
        ...current,
        isEnded: true
      });
      this.saveToStorage();
    }
  }

  leaveMeeting() {
    this.activeMeeting.set(null);
    try { sessionStorage.removeItem(MeetingStatusService.STORAGE_KEY); } catch {}
  }

  getMeetingReturnUrl(): string {
    const meeting = this.activeMeeting();
    if (!meeting) return '';
    return `/meetings/${meeting.meetingId}`;
  }

  private saveToStorage() {
    try {
      const current = this.activeMeeting();
      if (current) {
        sessionStorage.setItem(MeetingStatusService.STORAGE_KEY, JSON.stringify(current));
      } else {
        sessionStorage.removeItem(MeetingStatusService.STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
}
