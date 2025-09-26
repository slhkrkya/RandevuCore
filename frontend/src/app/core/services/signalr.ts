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

  stop() {
    return this.connection?.stop();
  }
}
