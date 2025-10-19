import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login';
import { RegisterComponent } from './features/auth/register/register';
import { authGuard, guestGuard } from './core/guards/auth-guard';
import { MeetingListComponent } from './features/meeting/meeting-list/meeting-list';
import { MeetingRoomComponent } from './features/meeting/meeting-room/meeting-room';
import { MeetingCreateComponent } from './features/meeting/meeting-create/meeting-create';
import { MeetingPrejoinComponent } from './features/meeting/meeting-prejoin/meeting-prejoin';
import { ProfileComponent } from './features/profile/profile';
import { SettingsComponent } from './features/settings/settings';
import { HomeComponent } from './features/home/home';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },
  { path: 'meetings', component: MeetingListComponent, canActivate: [authGuard] },
  { path: 'meetings/new', component: MeetingCreateComponent, canActivate: [authGuard] },
  { path: 'meetings/:id/prejoin', component: MeetingPrejoinComponent, canActivate: [authGuard] },
  { path: 'meetings/:id', component: MeetingRoomComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] }
];