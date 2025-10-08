import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { AppConfigService } from './app-config.service';

@Injectable({ providedIn: 'root' })
export class SignalRService {
  private connection?: signalR.HubConnection;
  constructor(private cfg: AppConfigService) {}

  start(token: string) {
    if (this.connection) return;
    
    // Check if we're in production
    const isProduction = window.location.hostname !== 'localhost' && 
                        !window.location.hostname.includes('127.0.0.1') &&
                        !window.location.hostname.includes('dev');
    
    // Use environment-appropriate URL
    const wsUrl = isProduction ? 
      `https://${window.location.host}/ws` : 
      (this.cfg.wsUrl || `${this.cfg.apiBaseUrl}/ws`);
    
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(wsUrl, { 
        accessTokenFactory: () => token,
        transport: signalR.HttpTransportType.LongPolling,
        skipNegotiation: true
      })
      .withAutomaticReconnect([0, 2000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Information)
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

  invoke(methodName: string, ...args: any[]) {
    return this.connection?.invoke(methodName, ...args);
  }

  stop() {
    return this.connection?.stop();
  }
}
