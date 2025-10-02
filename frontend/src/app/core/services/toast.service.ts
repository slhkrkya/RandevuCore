import { Injectable, signal } from '@angular/core';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  public toasts = this._toasts.asReadonly();

  show(message: string, type: ToastType = 'info', durationMs = 4000): string {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, message, type };
    this._toasts.update(list => [toast, ...list]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
    return id;
  }

  info(msg: string, ms?: number) { return this.show(msg, 'info', ms); }
  success(msg: string, ms?: number) { return this.show(msg, 'success', ms); }
  warning(msg: string, ms?: number) { return this.show(msg, 'warning', ms); }
  error(msg: string, ms?: number) { return this.show(msg, 'error', ms); }

  dismiss(id: string) {
    this._toasts.update(list => list.filter(t => t.id !== id));
  }

  clear() { this._toasts.set([]); }
}


