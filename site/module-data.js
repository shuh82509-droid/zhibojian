(() => {
  'use strict';
  const segments = location.pathname.split('/').filter(Boolean);
  const employeeIndex = segments.findIndex(segment => /^fd-\d+$/i.test(segment));
  const root = employeeIndex >= 0 ? `/${segments.slice(0, employeeIndex + 2).join('/')}/` : '/';
  const endpoint = `${root}api/modules/live-data`;
  let timer = 0;

  async function refresh() {
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.error || 'module_data_unavailable');
      window.LiveHubModuleData = payload.data;
      document.dispatchEvent(new CustomEvent('livehub:module-data', { detail: payload.data }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent('livehub:module-data-error', { detail: { message: error.message || 'module_data_unavailable' } }));
    }
  }

  window.LiveHubRefreshModuleData = refresh;
  refresh();
  timer = window.setInterval(refresh, 15 * 60 * 1000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
})();
