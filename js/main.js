/* ============================================
   THE STALEY SOCIAL — Main JS
   Scroll reveals, counter animations,
   nav behavior, FAQ, mobile menu
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ─── Nav scroll behavior ───
  const nav = document.getElementById('main-nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── Mobile menu ───
  const hamburger = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('nav-mobile');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open');
    });
    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
      });
    });
  }

  // ─── Active nav link ───
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .nav-mobile a').forEach(link => {
    const linkPath = link.getAttribute('href');
    if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
      link.classList.add('active');
    }
  });

  // ─── Scroll reveal ───
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => revealObs.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('visible'));
  }

  // ─── Counter animations ───
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const duration = 1800;
    const isDecimal = String(target).includes('.');
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const start = performance.now();

    function step(now) {
      const elapsed = Math.min((now - start) / duration, 1);
      // Ease out cubic
      const progress = 1 - Math.pow(1 - elapsed, 3);
      const current = target * progress;
      const display = isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString();
      el.textContent = prefix + display + suffix;
      if (elapsed < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const counterEls = document.querySelectorAll('[data-counter]');
  if (counterEls.length && 'IntersectionObserver' in window) {
    const counterObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counterEls.forEach(el => counterObs.observe(el));
  }

  // ─── FAQ accordion ───
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
      // Toggle current
      if (!isOpen) item.classList.add('open');
    });
  });

  // ─── Contact form ───
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'Message sent!';
      btn.disabled = true;
      btn.style.opacity = '0.7';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.style.opacity = '';
        form.reset();
      }, 4000);
    });
  }

  // ─── Smooth scroll for anchor links ───
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ─── Hero text animation (stagger lines) ───
  const heroLines = document.querySelectorAll('.hero-line');
  heroLines.forEach((line, i) => {
    line.style.opacity = '0';
    line.style.transform = 'translateY(40px)';
    line.style.transition = `opacity 0.7s ease ${0.1 + i * 0.12}s, transform 0.7s ease ${0.1 + i * 0.12}s`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        line.style.opacity = '1';
        line.style.transform = 'translateY(0)';
      });
    });
  });

  // ─── Subtle cursor glow (desktop only) ───
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const glow = document.createElement('div');
    glow.style.cssText = `
      position: fixed; pointer-events: none; z-index: 9999;
      width: 300px; height: 300px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%);
      transform: translate(-50%, -50%);
      transition: opacity 0.3s ease;
      opacity: 0;
    `;
    document.body.appendChild(glow);

    let mouseX = 0, mouseY = 0;
    let glowX = 0, glowY = 0;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      glow.style.opacity = '1';
    });

    window.addEventListener('mouseleave', () => {
      glow.style.opacity = '0';
    });

    function animateGlow() {
      glowX += (mouseX - glowX) * 0.08;
      glowY += (mouseY - glowY) * 0.08;
      glow.style.left = glowX + 'px';
      glow.style.top = glowY + 'px';
      requestAnimationFrame(animateGlow);
    }
    animateGlow();
  }

});
