// Génère les "points lumineux" turquoise du fond (purement décoratif).
(function () {
  function populate(el, count, minSize, maxSize) {
    if (!el) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      const size = minSize + Math.random() * (maxSize - minSize);
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.opacity = (0.35 + Math.random() * 0.6).toFixed(2);
      s.style.animationDelay = (Math.random() * 9).toFixed(2) + 's';
      s.style.animationDuration = (6 + Math.random() * 6).toFixed(2) + 's';
      frag.appendChild(s);
    }
    el.appendChild(frag);
  }

  window.addEventListener('DOMContentLoaded', function () {
    populate(document.getElementById('starfield'), 40, 3, 12);
    populate(document.getElementById('screenStars'), 30, 4, 16);
  });
})();
