import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.html',
  styleUrls: ['./toast.css']
})
export class ToastContainerComponent {
  private toast = inject(ToastService);
  toasts = computed(() => this.toast.toasts());

  dismiss(id: string) { this.toast.dismiss(id); }
}


