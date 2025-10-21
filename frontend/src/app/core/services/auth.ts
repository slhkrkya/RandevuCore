import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AppConfigService } from './app-config.service';
import { Observable, tap } from 'rxjs';

interface AuthResponse {
  token: string;
  email: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl: string;
  private authState = signal<boolean>(!!this.getToken());

  constructor(private http: HttpClient, private cfg: AppConfigService) {
    this.apiUrl = (this.cfg.apiBaseUrl || '') + '/api/Auth';
  }

  get isAuthenticated() {
    return this.authState.asReadonly();
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, { email, password })
      .pipe(tap(res => {
        localStorage.setItem('token', res.token);
        this.authState.set(true);
      }));
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, { name, email, password })
      .pipe(tap(res => {
        localStorage.setItem('token', res.token);
        this.authState.set(true);
      }));
  }

  logout() {
    localStorage.removeItem('token');
    this.authState.set(false);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getCurrentUserId(): string | null {
    const token = this.getToken();
    if (!token) return null;
    
    try {
      // JWT token'ı decode et (payload kısmı)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub || payload.userId || payload.id || null;
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  }

  getCurrentUserName(): string | null {
    const token = this.getToken();
    if (!token) return null;
    
    try {
      // JWT token'ı decode et (payload kısmı)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.name || payload.userName || payload.username || 'Kullanıcı';
    } catch (error) {
      console.error('Error decoding token:', error);
      return 'Kullanıcı';
    }
  }
}