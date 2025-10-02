import { HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth';
import { catchError } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);

  const token = localStorage.getItem('token');
  let request = req;

  // Attach token if present
  if (token) {
    request = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

    // Proactive expiry check (decode JWT exp)
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      const exp = typeof payload.exp === 'number' ? payload.exp : 0; // seconds since epoch
      const now = Math.floor(Date.now() / 1000);
      if (exp && now >= exp) {
        // Token already expired -> logout and redirect once
        auth.logout();
        toast.warning('Oturum süreniz doldu. Lütfen tekrar giriş yapın.', 5000);
        router.navigate(['/login']);
        return throwError(() => new Error('JWT expired'));
      }
    } catch {}
  }

  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        auth.logout();
        toast.warning('Oturum süreniz doldu veya yetkiniz yok. Lütfen giriş yapın.', 5000);
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
