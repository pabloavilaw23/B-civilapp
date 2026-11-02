function initAuthHeaderElevation() {
  const header = document.querySelector('.site-header');

  if (!header) {
    return;
  }

  const applyElevation = () => {
    if (window.scrollY > 8) {
      header.style.boxShadow = 'var(--shadow-md)';
    } else {
      header.style.boxShadow = '';
    }
  };

  applyElevation();
  window.addEventListener('scroll', applyElevation, { passive: true });
}

document.addEventListener('DOMContentLoaded', initAuthHeaderElevation);
