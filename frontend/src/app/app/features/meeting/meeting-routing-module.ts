import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Meeting } from './meeting';

const routes: Routes = [{ path: '', component: Meeting }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MeetingRoutingModule { }
