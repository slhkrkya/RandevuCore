import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { SettingsPanelComponent } from '../settings-panel/settings-panel.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, SettingsPanelComponent],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css']
})
export class NavbarComponent {
  isAuthenticated = computed(() => this.auth.isAuthenticated());
  currentRoute = '';
  isMobileMenuOpen = false;
  isClosing = false;
  isSettingsMenuOpen = signal(false);

  constructor(
    private auth: AuthService, 
    private router: Router
  ) {
    // Track current route for page title
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
        this.isMobileMenuOpen = false; // Close mobile menu on route change
        this.isSettingsMenuOpen.set(false); // Close settings menu on route change
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
      case '/settings':
        return 'Ayarlar';
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

  // Settings menu methods
  toggleSettingsMenu() {
    this.isSettingsMenuOpen.set(!this.isSettingsMenuOpen());
  }

  closeSettingsMenu() {
    this.isSettingsMenuOpen.set(false);
  }
}