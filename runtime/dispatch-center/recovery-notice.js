(() => {
  'use strict';
  // The shell owns the notice when this module is embedded. The relative script
  // URL stays inside the current production, candidate, or local mount path.
  if (window.top !== window.self) return;
  const notice = document.getElementById('live-hub-recovery-notice');
  if (!notice) return;
  const root = document.documentElement;
  root.setAttribute('data-live-hub-recovery-banner', 'true');
  notice.hidden = false;
  const measure = () => root.style.setProperty(
    '--live-hub-recovery-height',
    `${Math.ceil(notice.getBoundingClientRect().height)}px`,
  );
  measure();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(notice);
  window.addEventListener('resize', measure);
})();
