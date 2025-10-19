import { Component, OnInit, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { ScrollSmootherService } from '../../core/services/scroll-smoother.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.html',
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit, AfterViewInit {
  isAuthenticated = false;

  @ViewChild('featuresSection', { static: false }) featuresSection!: ElementRef<HTMLElement>;
  @ViewChild('ctaSection', { static: false }) ctaSection!: ElementRef<HTMLElement>;
  @ViewChild('footerSection', { static: false }) footerSection!: ElementRef<HTMLElement>;

  constructor(
    private auth: AuthService,
    private scrollSmoother: ScrollSmootherService
  ) {}

  ngOnInit() {
    // Authentication durumunu kontrol et
    this.isAuthenticated = this.auth.isAuthenticated();
  }

  ngAfterViewInit() {
    // Scroll animasyonlarını başlat
    setTimeout(() => {
      this.initScrollAnimations();
    }, 100);
  }

  private initScrollAnimations() {
    // Features section animasyonu
    if (this.featuresSection) {
      this.scrollSmoother.observeElement(this.featuresSection);
    }

    // CTA section animasyonu
    if (this.ctaSection) {
      this.scrollSmoother.observeElement(this.ctaSection);
    }

    // Footer section animasyonu
    if (this.footerSection) {
      this.scrollSmoother.observeElement(this.footerSection);
    }
  }
}
