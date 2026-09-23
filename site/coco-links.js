(() => {
  const marker = '/modules/';
  const markerIndex = location.pathname.indexOf(marker);
  const root = markerIndex >= 0 ? location.pathname.slice(0, markerIndex + 1) : '/fd-027340/live-center-workbench/';
  const api = `${root}api/feishu/`;
  const isDocument = value => /^https:\/\/jqx28l0j4lx\.feishu\.cn\/(?:wiki|docx)\//i.test(value);
  const isResource = value => /^https:\/\/internal-api-(?:drive-stream|lark-file)\.feishu\.cn\//i.test(value);
  const rewrite = node => {
    const scope = node?.querySelectorAll ? node : document;
    scope.querySelectorAll('a[href]').forEach(link => {
      if (isDocument(link.href) && !link.dataset.cocoLink) {
        link.dataset.cocoLink = '1';
        link.href = `${api}view?url=${encodeURIComponent(link.href)}`;
      }
    });
    scope.querySelectorAll('img[src],video[src],source[src]').forEach(media => {
      if (isResource(media.src) && !media.dataset.cocoResource) {
        media.dataset.cocoResource = '1';
        media.src = `${api}resource?url=${encodeURIComponent(media.src)}`;
      }
    });
  };
  const start = () => {
    rewrite(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(rewrite))).observe(document.documentElement, {childList:true,subtree:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
