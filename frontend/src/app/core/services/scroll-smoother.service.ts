import { Injectable, ElementRef } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ScrollSmootherService {
  private observer: IntersectionObserver | null = null;
  private animatedElements = new Set<Element>();

  constructor() {
    this.initScrollObserver();
  }

  private initScrollObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.animateElement(entry.target);
          }
        });
      },
      {
        threshold: 0.05,
        rootMargin: '0px 0px -100px 0px'
      }
    );
  }

  observeElement(element: ElementRef<HTMLElement> | HTMLElement) {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    
    if (!this.animatedElements.has(el)) {
      this.animatedElements.add(el);
      
      // Features section için özel başlangıç durumu
      if (el.querySelector('.group')) {
        // Ana element'i gizle
        el.style.opacity = '0';
        el.style.transform = 'translateY(120px)';
        el.style.transition = 'all 2s cubic-bezier(0.23, 1, 0.32, 1)';
        
        // Kartları başlangıçta sağda gizle
        const cards = el.querySelectorAll('.group');
        cards.forEach((card) => {
          const cardEl = card as HTMLElement;
          cardEl.style.opacity = '0';
          cardEl.style.transform = 'translateX(100px)';
          cardEl.style.transition = 'all 1.2s cubic-bezier(0.23, 1, 0.32, 1)';
        });
      } else {
        // Diğer section'lar için normal başlangıç durumu
        el.style.opacity = '0';
        el.style.transform = 'translateY(120px)';
        el.style.transition = 'all 2s cubic-bezier(0.23, 1, 0.32, 1)';
      }
      
      this.observer?.observe(el);
    }
  }

  private animateElement(element: Element) {
    const el = element as HTMLElement;
    
    // Features section için özel animasyon
    if (el.querySelector('.group')) {
      this.animateFeaturesSection(el);
    } else {
      // Diğer section'lar için normal animasyon
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }
    
    // Remove from observer after animation
    this.observer?.unobserve(element);
  }

  private animateFeaturesSection(element: HTMLElement) {
    // Ana element'i görünür yap
    element.style.opacity = '1';
    element.style.transform = 'translateY(0)';
    
    // Staggered animasyon için kartları bul ve sağdan gelme efekti
    const cards = element.querySelectorAll('.group');
    cards.forEach((card, index) => {
      const cardEl = card as HTMLElement;
      
      // Her kart sırayla sağdan kayarak gelsin
      setTimeout(() => {
        cardEl.style.opacity = '1';
        cardEl.style.transform = 'translateX(0)';
      }, index * 200); // Her kart 0.2s gecikme ile
    });
  }

  // Smooth scroll to element
  scrollToElement(element: ElementRef<HTMLElement> | HTMLElement, offset: number = 0) {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    const elementPosition = el.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }

  // Smooth scroll to top
  scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  // Parallax effect for background elements
  initParallax(element: ElementRef<HTMLElement> | HTMLElement, speed: number = 0.5) {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    
    const handleScroll = () => {
      const scrolled = window.pageYOffset;
      const rate = scrolled * -speed;
      el.style.transform = `translateY(${rate}px)`;
    };

    window.addEventListener('scroll', handleScroll);
    
    // Return cleanup function
    return () => window.removeEventListener('scroll', handleScroll);
  }
}
