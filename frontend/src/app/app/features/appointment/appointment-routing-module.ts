import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Appointment } from './appointment';

const routes: Routes = [{ path: '', component: Appointment }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AppointmentRoutingModule { }
