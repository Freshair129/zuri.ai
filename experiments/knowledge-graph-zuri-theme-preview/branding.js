(() => {
  const replacements = [
    [/The\s+AI\s+Coding\s+Dictionary/gi, 'Zuri Knowledge Graph'],
    [/AI\s+Coding\s+Dictionary/gi, 'Zuri Knowledge Graph'],
    [/HEARD\s+IN\s+THE\s+WILD/gi, 'IN CONTEXT'],
    [/\bAVOID\b/gi, 'USAGE NOTE'],
    [/CONNECTS\s+TO/gi, 'RELATED KNOWLEDGE'],
    [/\b(\d[\d,]*)\s+TERMS?\b/gi, '$1 NODES'],
    [/\bN\s+TERMS?\b/gi, 'N NODES'],
    [/AIHero\.dev/gi, 'Zuri.ai'],
    [/aihero\.dev/gi, 'Zuri.ai'],
    [/AI\s+Hero/gi, 'Zuri.ai'],
  ];

  function rebrandText(value) {
    return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }

  function isPublisherCredit(element) {
    const link = element.closest('a[href]');
    if (!link) return false;

    const creditLabel = /^(?:AI\s+Hero|AIHero\.dev|aihero\.dev)$/i.test((link.textContent ?? '').trim());
    if (creditLabel) return true;

    try {
      const hostname = new URL(link.href, document.baseURI).hostname.toLowerCase();
      return hostname === 'aihero.dev' || hostname.endsWith('.aihero.dev');
    } catch {
      return false;
    }
  }

  function applyBranding() {
    if (document.title !== 'Zuri Knowledge Graph') document.title = 'Zuri Knowledge Graph';
    document.documentElement.dataset.zuriGraphPreview = 'true';
    if (!document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        parent &&
        !parent.closest('script, style, noscript, template, textarea, input, code, pre') &&
        !isPublisherCredit(parent)
      ) {
        const replacement = rebrandText(node.nodeValue ?? '');
        if (replacement !== node.nodeValue) node.nodeValue = replacement;
      }
      node = walker.nextNode();
    }
  }

  applyBranding();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBranding, { once: true });
  }

  if (document.documentElement && typeof MutationObserver === 'function') {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        applyBranding();
      });
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }
})();
