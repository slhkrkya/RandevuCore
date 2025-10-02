import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './core/components/navbar/navbar';
import { ToastContainerComponent } from './core/components/toast/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, ToastContainerComponent],
  template: '<app-toast-container></app-toast-container><app-navbar></app-navbar><router-outlet></router-outlet>',
})
export class App {   
  title = signal('frontend');
}