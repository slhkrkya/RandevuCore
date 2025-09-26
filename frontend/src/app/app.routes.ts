import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login';
import { RegisterComponent } from './features/auth/register/register';
import { AppointmentList } from './features/appointment/appointment-list/appointment-list';
import { authGuard, guestGuard } from './core/guards/auth-guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },
  { path: 'appointments', component: AppointmentList, canActivate: [authGuard] },
  { path: '', redirectTo: 'appointments', pathMatch: 'full' }
];