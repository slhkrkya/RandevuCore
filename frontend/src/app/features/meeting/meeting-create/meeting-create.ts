import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppConfigService } from '../../../core/services/app-config.service';
import { AuthService } from '../../../core/services/auth';
import { map } from 'rxjs';

@Component({
  selector: 'app-meeting-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './meeting-create.html',
  styleUrls: ['./meeting-create.css']
})
export class MeetingCreateComponent {
  form!: FormGroup;
  loading = false;
  error: string | null = null;
  users: any[] = [];
  selectedInvitees: string[] = [];

  // Minimum tarih - şu anki zaman
  get minDateTime(): string {
    const now = new Date();
    // Türkiye saatine göre ayarla (UTC+3)
    const turkeyTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return turkeyTime.toISOString().slice(0, 16);
  }

  // Bitiş tarihi için minimum - başlangıç tarihinden sonra
  get minEndDateTime(): string {
    const startsAt = this.form.get('startsAt')?.value;
    if (startsAt) {
      return startsAt;
    }
    return this.minDateTime;
  }

  constructor(private fb: FormBuilder, private http: HttpClient, private router: Router, private cfg: AppConfigService, private auth: AuthService) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      startsAt: ['', Validators.required],
      endsAt: ['', Validators.required],
      inviteeIds: [''],
      notes: ['']
    });
  }

  ngOnInit() {
    this.http.get<any[]>(`${this.cfg.apiBaseUrl || ''}/api/users`)
      .subscribe(u => {
        // Filter out current user from invitee list since they are already the host
        const currentUserId = this.auth.getCurrentUserId();
        this.users = u.filter(user => user.id !== currentUserId);
      });

    // Başlangıç tarihi değiştiğinde bitiş tarihini güncelle
    this.form.get('startsAt')?.valueChanges.subscribe(startsAt => {
      const endsAt = this.form.get('endsAt');
      if (startsAt && endsAt?.value && new Date(endsAt.value) <= new Date(startsAt)) {
        // Bitiş tarihi başlangıç tarihinden önce veya eşitse, başlangıç + 1 saat yap
        const newEndTime = new Date(new Date(startsAt).getTime() + 60 * 60 * 1000);
        endsAt.setValue(newEndTime.toISOString().slice(0, 16));
      }
    });
  }

  submit() {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.error = null;
    const value = this.form.value;
    const payload = { ...value, inviteeIds: this.selectedInvitees };
    this.http.post(`${this.cfg.apiBaseUrl || ''}/api/meetings`, payload).subscribe({
      next: () => this.router.navigate(['/meetings']),
      error: (err) => {
        this.error = err?.error?.error || 'Kaydetme başarısız';
        this.loading = false;
      },
      complete: () => (this.loading = false)
    });
  }

  onInviteeToggle(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const id = input.value;
    if (input.checked) {
      if (!this.selectedInvitees.includes(id)) this.selectedInvitees.push(id);
    } else {
      this.selectedInvitees = this.selectedInvitees.filter(x => x !== id);
    }
  }
}


