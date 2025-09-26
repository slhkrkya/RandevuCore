import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
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

  constructor(private fb: FormBuilder, private http: HttpClient, private router: Router) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      startsAt: ['', Validators.required],
      endsAt: ['', Validators.required],
      inviteeIds: [''],
      notes: ['']
    });
  }

  ngOnInit() {
    this.http.get<any[]>('http://localhost:5125/api/users')
      .subscribe(u => this.users = u);
  }

  submit() {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.error = null;
    const value = this.form.value;
    const payload = { ...value, inviteeIds: this.selectedInvitees };
    this.http.post('http://localhost:5125/api/meetings', payload).subscribe({
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


