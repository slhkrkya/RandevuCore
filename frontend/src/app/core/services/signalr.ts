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
    
    // Use environment-appropriate URL (dev uses proxy /ws)
    const wsUrl = isProduction ? 
      `wss://${window.location.host}/ws` : 
      `/ws`;
    
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(wsUrl, { 
        accessTokenFactory: () => token,
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true
      })
      .withAutomaticReconnect([0, 2000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Information)
      .build();

    // Add visibility change listener to handle tab switching
    this.setupVisibilityChangeHandler();
    
    return this.connection.start();
  }
  
  private setupVisibilityChangeHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && 
          this.connection && 
          this.connection.state !== signalR.HubConnectionState.Connected) {
        this.connection.start().catch(error => {
        });
      }
    });
  }

  on<T>(eventName: string, handler: (payload: T) => void) {
    if (!this.connection) return;
    
    // Remove existing listener first to prevent duplicates
    this.connection.off(eventName);
    this.connection.on(eventName, handler);
  }

  off(eventName: string) {
    this.connection?.off(eventName);
  }

  joinRoom(roomId: string) {
    return this.connection?.invoke('JoinRoom', roomId);
  }

  leaveRoom(roomId: string) {
    return this.connection?.invoke('LeaveRoom', roomId);
  }

  sendToRoom(roomId: string, eventName: string, payload: unknown) {
    if (this.connection?.state !== signalR.HubConnectionState.Connected) {
      throw new Error("SignalR connection not ready");
    }
    return this.connection.invoke('SendToRoom', roomId, eventName, payload);
  }

  grant(roomId: string, targetUserId: string, permission: 'cam' | 'mic' | 'screen') {
    return this.connection?.invoke('GrantPermission', roomId, targetUserId, permission);
  }

  invoke(methodName: string, ...args: any[]) {
    if (this.connection?.state !== signalR.HubConnectionState.Connected) {
      throw new Error("SignalR connection not ready");
    }
    return this.connection.invoke(methodName, ...args);
  }

  stop() {
    return this.connection?.stop();
  }

  isConnected(): boolean {
    return this.connection?.state === signalR.HubConnectionState.Connected;
  }
}
