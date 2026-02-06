document.addEventListener('DOMContentLoaded', function() {
    // Update footer year dynamically
    updateFooterYear();
    
    // Initialize scroll-reveal animations
    initScrollReveal();

    // Enable smooth scrolling for anchor links
    initSmoothScroll();

    // Pause marquee on hover
    initMarquee();
});

function updateFooterYear() {
    const currentYear = new Date().getFullYear();
    const footerElements = document.querySelectorAll('footer p');
    
    footerElements.forEach(footer => {
        const text = footer.textContent;
        // Only update the year portion, keep the rest
        footer.textContent = text.replace(/\d{4}/, currentYear);
    });
}

function initScrollReveal() {
    // Add .reveal class to all major sections
    const sections = document.querySelectorAll(
        '.section, .process-step, .card, .service-item, .about-link-card, .outcome, .belief-card, .now-card, .about-text'
    );
    
    sections.forEach((el, i) => {
        el.classList.add('reveal');
        // Stagger the animation slightly
        el.style.transitionDelay = `${Math.min(i * 0.05, 0.3)}s`;
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.06,
        rootMargin: '0px 0px -30px 0px'
    });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

function initMarquee() {
    const strip = document.querySelector('.marquee-strip');
    if (!strip) return;
    
    const track = strip.querySelector('.marquee-track');
    if (!track) return;
    
    strip.addEventListener('mouseenter', () => {
        track.style.animationPlayState = 'paused';
    });
    
    strip.addEventListener('mouseleave', () => {
        track.style.animationPlayState = 'running';
    });
}
