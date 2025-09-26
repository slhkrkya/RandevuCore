import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';

@Injectable({ providedIn: 'root' })
export class SignalRService {
  private connection?: signalR.HubConnection;

  start(token: string) {
    if (this.connection) return;
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('http://localhost:5125/ws', { accessTokenFactory: () => token })
      .withAutomaticReconnect()
      .build();

    return this.connection.start();
  }

  on<T>(eventName: string, handler: (payload: T) => void) {
    this.connection?.on(eventName, handler);
  }

  joinRoom(roomId: string) {
    return this.connection?.invoke('JoinRoom', roomId);
  }

  leaveRoom(roomId: string) {
    return this.connection?.invoke('LeaveRoom', roomId);
  }

  sendToRoom(roomId: string, eventName: string, payload: unknown) {
    return this.connection?.invoke('SendToRoom', roomId, eventName, payload);
  }

  grant(roomId: string, targetUserId: string, permission: 'cam' | 'mic' | 'screen') {
    return this.connection?.invoke('GrantPermission', roomId, targetUserId, permission);
  }

  stop() {
    return this.connection?.stop();
  }
}
