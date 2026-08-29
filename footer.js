(function () {
  var LAST_EDITED = '29 August 2026';

  function renderFooter() {
    var footer = document.querySelector('footer.site-footer');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'site-footer';
      document.body.appendChild(footer);
    }
    footer.innerHTML = '<p>This page was last manually edited on ' + LAST_EDITED + '.</p>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderFooter);
  } else {
    renderFooter();
  }
})();
