import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppConfigService } from '../../../core/services/app-config.service';

@Component({
  selector: 'app-appointment-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './appointment-form.html',
  styleUrls: ['./appointment-form.css']
})
export class AppointmentForm {
  form!: FormGroup;

  loading = false;
  error: string | null = null;

  constructor(private fb: FormBuilder, private http: HttpClient, private router: Router, private cfg: AppConfigService) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      startsAt: ['', Validators.required],
      endsAt: ['', Validators.required],
      inviteeId: ['', Validators.required],
      notes: ['']
    });
  }

  submit() {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.error = null;
    this.http.post(`${this.cfg.apiBaseUrl || ''}/api/appointments`, this.form.value).subscribe({
      next: () => this.router.navigate(['/appointments']),
      error: (err) => {
        this.error = err?.error?.error || 'Kaydetme başarısız';
        this.loading = false;
      },
      complete: () => (this.loading = false)
    });
  }
}
