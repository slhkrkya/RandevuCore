import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './core/components/navbar/navbar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent],
  template: '<app-navbar></app-navbar><router-outlet></router-outlet>',
})
export class App {   
  title = signal('frontend');
}