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
    this.apiUrl = this.cfg.apiBaseUrl + '/api/Auth';
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
}