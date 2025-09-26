import { HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const token = localStorage.getItem('token');
  if (!token) return next(req);
  const clone = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return next(clone);
};
