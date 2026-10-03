'use strict';

/* Wikipedia-style table of contents for the sidebar: built from the page's
   section headings, so adding an <h2> to the content adds it here too. The
   section being read is highlighted as the page scrolls, and the list can
   be hidden, which is remembered for the next visit. */
(function () {
  var toc = document.getElementById('toc');
  var list = document.getElementById('toc-list');
  var toggle = document.getElementById('toc-toggle');
  var content = document.getElementById('content');
  if (!toc || !list || !content) return;

  var HIDDEN_KEY = 'unusuale-toc-hidden';

  function slug(text) {
    return text.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  }

  // "(Top)" first, as on Wikipedia, then one entry per section heading.
  var title = content.querySelector('.page-title');
  if (title && !title.id) title.id = 'top';
  var targets = [{ id: title ? title.id : '', label: '(Top)' }];

  content.querySelectorAll('h2').forEach(function (heading) {
    if (!heading.id) heading.id = slug(heading.textContent);
    targets.push({ id: heading.id, label: heading.textContent.trim() });
  });

  var links = targets.map(function (target) {
    var item = document.createElement('li');
    item.className = 'toc-item';
    var link = document.createElement('a');
    link.href = '#' + target.id;
    link.textContent = target.label;
    item.appendChild(link);
    list.appendChild(item);
    return link;
  });

  // The current section is the last heading to have passed a line a little
  // way down the viewport; until the first one does, that's "(Top)".
  function updateActive() {
    var line = window.innerHeight * 0.25;
    var active = 0;
    targets.forEach(function (target, i) {
      var node = target.id && document.getElementById(target.id);
      if (i > 0 && node && node.getBoundingClientRect().top <= line) active = i;
    });
    // At the very bottom the last section may be too short ever to reach
    // the line, so it wins outright.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      active = targets.length - 1;
    }
    setActive(active);
  }

  function setActive(index) {
    links.forEach(function (link, i) {
      link.parentNode.classList.toggle('active', i === index);
      if (i === index) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  // Clicking an entry highlights it straight away and keeps it highlighted
  // through the jump itself. Without this, a section near the end of the
  // page -- which can't scroll far enough up to cross the line -- would
  // leave the highlight on the section before it. The player's own next
  // scroll hands control back to the scroll position.
  var pinned = null;
  var pinFresh = false;

  function pin(index) {
    pinned = index;
    pinFresh = true;
    setActive(index);
  }

  links.forEach(function (link, i) {
    link.addEventListener('click', function () { pin(i); });
  });

  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (pinned !== null) {
        if (pinFresh) {
          pinFresh = false; // this scroll is the jump itself
          return;
        }
        pinned = null;
      }
      updateActive();
    });
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (pinned === null) updateActive();
  });

  // Arriving on a link to a section (index.html#cards) highlights it too.
  var arrived = targets.map(function (t) { return '#' + t.id; }).indexOf(window.location.hash);
  if (arrived > 0) pin(arrived);
  else updateActive();

  function setHidden(hidden) {
    toc.classList.toggle('collapsed', hidden);
    if (toggle) {
      toggle.textContent = hidden ? 'show' : 'hide';
      toggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    }
  }

  var startHidden = false;
  try { startHidden = localStorage.getItem(HIDDEN_KEY) === '1'; } catch (e) { /* storage blocked */ }
  setHidden(startHidden);

  if (toggle) {
    toggle.addEventListener('click', function () {
      var hidden = !toc.classList.contains('collapsed');
      setHidden(hidden);
      try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0'); } catch (e) { /* storage blocked */ }
    });
  }
})();
