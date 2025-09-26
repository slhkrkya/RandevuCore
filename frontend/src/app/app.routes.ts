import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login';
import { RegisterComponent } from './features/auth/register/register';
import { AppointmentList } from './features/appointment/appointment-list/appointment-list';
import { authGuard, guestGuard } from './core/guards/auth-guard';
import { AppointmentForm } from './features/appointment/appointment-form/appointment-form';
import { MeetingListComponent } from './features/meeting/meeting-list/meeting-list';
import { MeetingRoomComponent } from './features/meeting/meeting-room/meeting-room';
import { MeetingCreateComponent } from './features/meeting/meeting-create/meeting-create';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },
  { path: 'appointments', component: AppointmentList, canActivate: [authGuard] },
  { path: 'appointments/new', component: AppointmentForm, canActivate: [authGuard] },
  { path: 'meetings', component: MeetingListComponent, canActivate: [authGuard] },
  { path: 'meetings/new', component: MeetingCreateComponent, canActivate: [authGuard] },
  { path: 'meetings/:id', component: MeetingRoomComponent, canActivate: [authGuard] },
  { path: '', redirectTo: 'appointments', pathMatch: 'full' }
];