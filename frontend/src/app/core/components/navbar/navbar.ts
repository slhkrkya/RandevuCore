import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css']
})
export class NavbarComponent {
  isAuthenticated = computed(() => this.auth.isAuthenticated());
  currentRoute = '';
  isMobileMenuOpen = false;
  isClosing = false;

  constructor(private auth: AuthService, private router: Router) {
    // Track current route for page title
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
        this.isMobileMenuOpen = false; // Close mobile menu on route change
      });
  }

  getCurrentPageTitle(): string {
    switch (this.currentRoute) {
      case '/appointments':
        return 'Randevu Yönetimi';
      case '/meetings':
        return 'Toplantı Yönetimi';
      case '/profile':
        return 'Profil Ayarları';
      case '/login':
        return 'Giriş Yap';
      case '/register':
        return 'Kayıt Ol';
      default:
        if (this.currentRoute.startsWith('/meeting/')) {
          return 'Toplantı Odası';
        }
        return 'RandevuCore';
    }
  }

  navigateToProfile() {
    this.router.navigate(['/profile']);
  }

  navigateToSettings() {
    this.router.navigate(['/settings']);
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu() {
    this.isClosing = true;
    setTimeout(() => {
      this.isMobileMenuOpen = false;
      this.isClosing = false;
    }, 400); // Animation duration
  }
}


