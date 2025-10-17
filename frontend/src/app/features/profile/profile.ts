import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth';
import { Router } from '@angular/router';
import { AppConfigService } from '../../core/services/app-config.service';

interface Profile {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrls: ['./profile.css']
})
export class ProfileComponent implements OnInit {
  profile: Profile | null = null;
  profileForm!: FormGroup;
  passwordForm!: FormGroup;
  
  loading = false;
  isLoading = false; // HTML'de kullanılan
  profileLoading = false;
  passwordLoading = false;
  
  profileSuccess = false;
  profileError: string | null = null;
  passwordSuccess = false;
  passwordError: string | null = null;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private auth: AuthService,
    private router: Router,
    private cfg: AppConfigService
  ) {
    this.profileForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(100)]]
    });

    this.passwordForm = this.fb.group({
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {
    this.loadProfile();
  }

  passwordMatchValidator(form: FormGroup) {
    if (form.get('newPassword')?.value && form.get('confirmPassword')?.value) {
      return form.get('newPassword')?.value === form.get('confirmPassword')?.value 
        ? null : { passwordMismatch: true };
    }
    return null;
  }

  loadProfile() {
    this.profileLoading = true;
    this.profileError = null;

    const token = this.auth.getToken();
    if (!token) {
      this.profileError = 'Oturum açmanız gerekiyor';
      this.profileLoading = false;
      return;
    }

    this.http.get<Profile>(`${this.cfg.apiBaseUrl || ''}/api/Auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).subscribe({
      next: (profile) => {
        this.profile = profile;
        this.profileForm.patchValue({
          name: profile.name
        });
        this.profileLoading = false;
      },
      error: (err) => {
        this.profileError = 'Profil yüklenirken bir hata oluştu';
        this.profileLoading = false;
      }
    });
  }

  updateProfile() {
    if (this.profileForm.invalid || this.profileLoading) return;
    
    this.profileLoading = true;
    this.profileError = null;
    this.profileSuccess = false;

    const token = this.auth.getToken();
    if (!token) {
      this.profileError = 'Oturum açmanız gerekiyor';
      this.profileLoading = false;
      return;
    }

    const formValue = this.profileForm.value;

    this.http.put(`${this.cfg.apiBaseUrl || ''}/api/Auth/profile`, formValue, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).subscribe({
      next: (response) => {
        this.profileSuccess = true;
        this.loadProfile(); // Yeniden yükle
        this.profileLoading = false;
        setTimeout(() => {
          this.profileSuccess = false;
        }, 3000);
      },
      error: (err) => {
        this.profileError = err?.error?.error || err?.error?.message || 'Profil güncellenirken bir hata oluştu';
        this.profileLoading = false;
      }
    });
  }

  changePassword() {
    if (this.passwordForm.invalid || this.passwordLoading) return;
    
    this.passwordLoading = true;
    this.passwordError = null;
    this.passwordSuccess = false;

    const token = this.auth.getToken();
    if (!token) {
      this.passwordError = 'Oturum açmanız gerekiyor';
      this.passwordLoading = false;
      return;
    }

    const formValue = this.passwordForm.value;

    this.http.put(`${this.cfg.apiBaseUrl || ''}/api/Auth/change-password`, formValue, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).subscribe({
      next: (response) => {
        this.passwordSuccess = true;
        this.passwordForm.reset();
        this.passwordLoading = false;
        
        // Şifre değişikliği sonrası çıkış yap ve login'e yönlendir
        setTimeout(() => {
          this.auth.logout();
          this.router.navigate(['/login'], { 
            queryParams: { 
              message: 'Şifreniz başarıyla değiştirildi. Lütfen yeni şifre ile tekrar giriş yapın.' 
            } 
          });
        }, 2000);
      },
      error: (err) => {
        this.passwordError = err?.error?.error || err?.error?.message || 'Şifre değiştirilirken bir hata oluştu';
        this.passwordLoading = false;
      }
    });
  }

  getProfileErrors(controlName: string): string[] {
    const control = this.profileForm.get(controlName);
    const errors: string[] = [];
    
    if (control?.touched && control?.errors) {
      if (control.errors['required']) errors.push('Bu alan zorunludur');
      if (control.errors['minlength']) errors.push(`En az ${control.errors['minlength'].requiredLength} karakter gereklidir`);
      if (control.errors['maxlength']) errors.push(`En fazla ${control.errors['maxlength'].requiredLength} karakter olabilir`);
    }
    
    return errors;
  }

  getPasswordErrors(controlName: string): string[] {
    const control = this.passwordForm.get(controlName);
    const errors: string[] = [];
    
    if (control?.touched && control?.errors) {
      if (control.errors['required']) errors.push('Bu alan zorunludur');
      if (control.errors['minlength']) errors.push(`En az ${control.errors['minlength'].requiredLength} karakter gereklidir`);
    }
    
    return errors;
  }

  getPasswordFormErrors(): string[] {
    const errors: string[] = [];
    
    if (this.passwordForm.touched && this.passwordForm.errors) {
      if (this.passwordForm.errors['passwordMismatch']) {
        errors.push('Yeni şifreler uyuşmuyor');
      }
    }
    
    return errors;
  }

  resetProfileForm() {
    this.profileForm.reset();
    if (this.profile) {
      this.profileForm.patchValue({
        name: this.profile.name
      });
    }
  }
}
