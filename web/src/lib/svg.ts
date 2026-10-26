const FORBIDDEN = new Set(['script', 'foreignobject']);
const EVENT_ATTR = /^on/i;

export function sanitizeInlineSvg(svg: string): string {
  if (!svg) return '';
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return '';
    const all = root.querySelectorAll('*');
    for (const node of [root, ...Array.from(all)]) {
      const tag = node.nodeName.toLowerCase();
      if (FORBIDDEN.has(tag)) {
        node.remove();
        continue;
      }
      for (const attr of Array.from(node.attributes)) {
        if (EVENT_ATTR.test(attr.name)) node.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'xlink:href') && !attr.value.trim().startsWith('#')) {
          node.removeAttribute(attr.name);
        }
      }
    }
    root.setAttribute('width', '100%');
    root.setAttribute('height', '100%');
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    root.setAttribute('focusable', 'false');
    return new XMLSerializer().serializeToString(root);
  } catch {
    return '';
  }
}
