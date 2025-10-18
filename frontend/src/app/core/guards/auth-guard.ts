import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const token = auth.getToken();
  if (token) return true;
  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const token = auth.getToken();
  if (!token) return true;
  router.navigate(['/meetings']);
  return false;
};
