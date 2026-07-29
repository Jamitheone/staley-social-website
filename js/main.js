/* ============================================
   THE STALEY SOCIAL — Main JS
   Scroll reveals, counter animations,
   nav behavior, FAQ, mobile menu
   ============================================ */

// ─── Motion preference (respected throughout) ───
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Intro splash sequence ───
(function () {
  const overlay  = document.getElementById('introOverlay');
  const logo     = document.getElementById('introLogo');
  const tagline  = document.getElementById('introTagline');
  const bar      = document.getElementById('introBar');
  if (!overlay) return;

  // Reduced motion: skip the timed splash entirely
  if (reduceMotion) {
    overlay.classList.add('gone');
    return;
  }

  // A 2.6s scroll-locked splash on EVERY pageview is a bounce tax and it
  // delayed LCP by the whole sequence. First visit of the session only.
  try {
    if (sessionStorage.getItem('tssIntroSeen')) {
      overlay.classList.add('gone');
      return;
    }
    sessionStorage.setItem('tssIntroSeen', '1');
  } catch (e) {
    /* private mode: fall through and just play it */
  }

  // Lock scroll during intro
  document.body.style.overflow = 'hidden';

  // Step 1 — logo fades + scales in (200ms delay)
  setTimeout(() => { logo.classList.add('show'); }, 200);

  // Step 2 — tagline slides up (700ms)
  setTimeout(() => { tagline.classList.add('show'); }, 700);

  // Step 3 — progress bar fills (900ms)
  setTimeout(() => { bar.classList.add('fill'); }, 900);

  // Step 4 — logo glow pulse (1.4s)
  setTimeout(() => { logo.classList.add('glow'); }, 1400);

  // Step 5 — overlay fades out (2.6s)
  setTimeout(() => {
    overlay.classList.add('hide');
    document.body.style.overflow = '';
  }, 2600);

  // Step 6 — remove from DOM (3.4s)
  setTimeout(() => { overlay.classList.add('gone'); }, 3400);
})();

// ─── Lenis smooth scroll (optional — graceful fallback if CDN fails) ───
let lenis = null;
try {
  if (typeof Lenis !== 'undefined') {
    lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }
} catch (e) {
  lenis = null;
}

document.addEventListener('DOMContentLoaded', () => {

  // ─── Portfolio carousel ───
  const carousel = document.getElementById('portfolioCarousel');
  if (carousel) {
    const track = document.getElementById('pcTrack');
    const slides = track.querySelectorAll('.pc-slide');
    const dotsEl = document.getElementById('pcDots');
    const total = slides.length;
    let current = 0;
    let autoTimer;

    // Build dots
    const dots = Array.from({ length: total }, (_, i) => {
      const d = document.createElement('button');
      d.className = 'pc-dot' + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', `Go to slide ${i + 1}`);
      d.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(d);
      return d;
    });

    function goTo(idx) {
      current = (idx + total) % total;
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
      resetAuto();
    }

    function resetAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => goTo(current + 1), 4500);
    }

    document.getElementById('pcPrev').addEventListener('click', () => goTo(current - 1));
    document.getElementById('pcNext').addEventListener('click', () => goTo(current + 1));

    // Touch/swipe support
    let touchStartX = 0;
    carousel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) goTo(current + (diff > 0 ? 1 : -1));
    });

    // Pause on hover
    carousel.addEventListener('mouseenter', () => clearInterval(autoTimer));
    carousel.addEventListener('mouseleave', resetAuto);

    resetAuto();
  }

  // ─── Floating CTA popup ───
  const floatingCta = document.getElementById('floatingCta');
  const floatingCtaClose = document.getElementById('floatingCtaClose');
  if (floatingCta && window.innerWidth >= 768) {
    setTimeout(() => floatingCta.classList.add('visible'), 9000);
    floatingCtaClose?.addEventListener('click', () => {
      floatingCta.classList.remove('visible');
      setTimeout(() => floatingCta.classList.add('hidden'), 500);
    });
  }

  // ─── data-aos scroll reveal ───
  const aosEls = document.querySelectorAll('[data-aos]');
  if (aosEls.length && 'IntersectionObserver' in window) {
    const aosObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('aos-visible');
          aosObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    aosEls.forEach(el => aosObs.observe(el));
  } else {
    aosEls.forEach(el => el.classList.add('aos-visible'));
  }

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

  // ─── Scroll reveal + counter — Lenis-compatible ───
  // IO breaks with Lenis; use scroll + RAF check instead
  const allRevealEls = Array.from(document.querySelectorAll('.reveal, .reveal-wipe, .reveal-left, .reveal-right, .section-divider'));
  const allCounterEls = Array.from(document.querySelectorAll('[data-counter]'));
  const firedCounters = new Set();

  function isInView(el, offset = 80) {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight - offset && rect.bottom > 0;
  }

  function checkRevealAndCounters() {
    allRevealEls.forEach(el => {
      if (!el.classList.contains('visible') && isInView(el, 60)) {
        el.classList.add('visible');
        // If inside a reveal-group, trigger siblings too
        const group = el.closest('.reveal-group');
        if (group) {
          group.querySelectorAll('.reveal').forEach(sib => sib.classList.add('visible'));
        }
      }
    });

    allCounterEls.forEach(el => {
      if (!firedCounters.has(el) && isInView(el, 100)) {
        firedCounters.add(el);
        animateCounter(el);
      }
    });
  }

  // Scroll-driven, rAF-throttled. getBoundingClientRect is read at most once
  // per frame and only after an actual scroll, not every idle frame. This
  // replaces a perpetual rAF loop that forced a synchronous layout each frame
  // and competed with Lenis's own rAF, the main source of the scroll jank.
  let revealTicking = false;
  function onScrollReveal() {
    if (revealTicking) return;
    revealTicking = true;
    requestAnimationFrame(() => {
      checkRevealAndCounters();
      revealTicking = false;
    });
  }
  window.addEventListener('scroll', onScrollReveal, { passive: true });
  window.addEventListener('resize', onScrollReveal, { passive: true });
  if (lenis) lenis.on('scroll', onScrollReveal);   // catch Lenis smooth scroll

  // revealTicking is only cleared inside the rAF callback, so a dropped frame
  // (scrolling in a backgrounded or throttled tab) latched it true and every
  // later scroll returned early, leaving the rest of the page invisible even
  // after the tab came back. Clear the latch and sweep directly on refocus.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    revealTicking = false;
    checkRevealAndCounters();
  });

  // Initial pass (above-the-fold) + a safety pass after the splash lifts.
  setTimeout(checkRevealAndCounters, 150);
  setTimeout(checkRevealAndCounters, 2800);

  // ─── Counter animations ───
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const duration = 1800;
    const isDecimal = String(target).includes('.');
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';

    // Reduced motion: show the final number immediately, no count-up.
    if (reduceMotion) {
      const final = isDecimal ? target.toFixed(1) : Math.floor(target).toLocaleString();
      el.textContent = prefix + final + suffix;
      return;
    }

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

  // ─── FAQ accordion ───
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item.open').forEach(i => {
        i.classList.remove('open');
        i.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });
      // Toggle current
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // ─── Contact form — let it POST naturally; formsubmit redirects to ?sent=true ───
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', () => {
      const btn = form.querySelector('[type="submit"]');
      btn.textContent = 'Sending…';
      btn.disabled = true;
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
  // The intro splash covers the screen until ~2.6s, so kick the stagger off
  // when the splash lifts, otherwise it plays behind the overlay and the
  // visitor never sees it. With no splash (other pages / reduced motion),
  // run it immediately.
  const heroLines = document.querySelectorAll('.hero-line');
  if (heroLines.length) {
    // Gate on whether the splash is actually PLAYING, not merely present. It
    // stays in the DOM with .gone on repeat visits, and keying off existence
    // alone left the hero blank for 2.6s with no overlay covering it.
    const intro = document.getElementById('introOverlay');
    const introPlaying = intro && !reduceMotion && !intro.classList.contains('gone');
    const startDelay = introPlaying ? 2650 : 0;

    // Split headline lines into masked words: each word rises out of its own
    // clip. Non-headline hero-lines keep the blur-rise below.
    const headlineLines = Array.from(document.querySelectorAll('.hero-headline .hero-line'));
    const otherLines = Array.from(heroLines).filter(l => !headlineLines.includes(l));
    const words = [];
    if (!reduceMotion) {
      headlineLines.forEach(line => {
        const frag = document.createDocumentFragment();
        Array.from(line.childNodes).forEach(node => {
          const cls = node.nodeType === 1 ? node.className : '';
          const text = node.textContent;
          text.split(/(\s+)/).forEach(part => {
            if (!part.trim()) { frag.appendChild(document.createTextNode(part)); return; }
            const mask = document.createElement('span');
            mask.className = 'w-mask';
            const w = document.createElement('span');
            w.className = 'w' + (cls ? ' ' + cls : '');
            w.textContent = part;
            mask.appendChild(w);
            frag.appendChild(mask);
            words.push(w);
          });
        });
        line.textContent = '';
        line.appendChild(frag);
      });
    }

    if (reduceMotion) {
      heroLines.forEach(line => { line.style.opacity = '1'; });
    } else {
      // The headline starts clipped via CSS, so if the reveal never runs the H1
      // is invisible. A double rAF gets starved in a background or throttled
      // tab, which left it blank. One forced reflow commits the start state,
      // then the end state is set in the same tick, no frame callback needed.
      setTimeout(() => {
        words.forEach((w, i) => {
          w.style.transition = `transform 0.75s cubic-bezier(0.16,1,0.3,1) ${i * 0.04}s`;
        });
        void document.documentElement.offsetHeight;
        words.forEach(w => { w.style.transform = 'translateY(0)'; });
      }, startDelay);
      otherLines.forEach(line => {
        line.style.opacity = '0';
        line.style.transform = 'translateY(44px)';
        line.style.filter = 'blur(10px)';
      });
      setTimeout(() => {
        otherLines.forEach((line, i) => {
          const d = i * 0.09;
          line.style.transition = `opacity 0.85s cubic-bezier(0.16,1,0.3,1) ${d}s, transform 0.85s cubic-bezier(0.16,1,0.3,1) ${d}s, filter 0.85s cubic-bezier(0.16,1,0.3,1) ${d}s`;
        });
        void document.documentElement.offsetHeight;
        otherLines.forEach(line => {
          line.style.opacity = '1';
          line.style.transform = 'translateY(0)';
          line.style.filter = 'blur(0)';
        });
      }, startDelay);
    }
  }

  // ─── Subtle cursor glow (desktop only) ───
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const glow = document.createElement('div');
    glow.style.cssText = `
      position: fixed; pointer-events: none; z-index: 9999;
      width: 300px; height: 300px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(45,99,216,0.06) 0%, transparent 70%);
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
