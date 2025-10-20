import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ParticipantVolumeService {
  private currentRoomKey: string | null = null;
  // roomKey -> (userId -> volume)
  private roomVolumes = new Map<string, Map<string, number>>();
  private changesSubject = new BehaviorSubject<void>(undefined);
  changes$ = this.changesSubject.asObservable();

  setRoom(roomKey: string) {
    this.currentRoomKey = roomKey;
    if (!this.roomVolumes.has(roomKey)) {
      this.roomVolumes.set(roomKey, new Map());
    }
    this.changesSubject.next();
  }

  getVolume(userId: string): number {
    if (!this.currentRoomKey) return 1;
    const map = this.roomVolumes.get(this.currentRoomKey);
    const v = map?.get(userId);
    return typeof v === 'number' ? v : 1;
  }

  setVolume(userId: string, volume: number) {
    if (!this.currentRoomKey) return;
    const clamped = Math.max(0, Math.min(1, volume));
    let map = this.roomVolumes.get(this.currentRoomKey);
    if (!map) {
      map = new Map();
      this.roomVolumes.set(this.currentRoomKey, map);
    }
    map.set(userId, clamped);
    this.changesSubject.next();
  }
}


