import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.html',
  styleUrls: ['./register.css']
})
export class RegisterComponent {
  form: FormGroup;
  loading = false;
  error: string | null = null;
  success: string | null = null;
  showPassword = false;
  showConfirm = false;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordsMatchValidator });
  }

  onSubmit() {
    if (this.form.invalid || this.loading) return;
    this.error = null;
    this.success = null;
    this.loading = true;
    const { name, email, password } = this.form.value;
    this.auth.register(name!, email!, password!).subscribe({
      next: () => {
        this.success = 'Kayıt başarılı! Giriş yapmak için yönlendiriliyorsunuz...';
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 2000);
      },
      error: () => {
        this.error = 'Kayıt başarısız. Email kullanımda olabilir.';
        this.loading = false;
      },
      complete: () => (this.loading = false)
    });
  }

  private passwordsMatchValidator = (group: AbstractControl): ValidationErrors | null => {
    const pwd = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    if (!pwd || !confirm) return null;
    return pwd === confirm ? null : { passwordsMismatch: true };
  }
}