import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: 'auth', loadChildren: () => import('./app/features/auth/auth-module').then(m => m.AuthModule) },
  { path: 'appointment', loadChildren: () => import('./app/features/appointment/appointment-module').then(m => m.AppointmentModule) },
  { path: 'meeting', loadChildren: () => import('./app/features/meeting/meeting-module').then(m => m.MeetingModule) },
  { path: 'profile', loadChildren: () => import('./app/features/profile/profile-module').then(m => m.ProfileModule) },
  // Lazy load feature modules burada eklenecek
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
