// Original outline icons; no external requests or icon font.
(function (root) {
  const paths = {
    bridge:
      '<path d="M3 18V9m18 9V9M3 12h18M6 18v-3a6 6 0 0 1 12 0v3M7 6h10"/>',
    overview:
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    settings:
      '<path d="M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    book: '<path d="M12 5v15M12 5C9 3 6 3 3 4v14c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z"/>',
    browser:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    activity: '<path d="M4 6h2m4 0h10M4 12h2m4 0h10M4 18h2m4 0h10"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    external:
      '<path d="M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
    power: '<path d="M12 3v9m-5-7a8 8 0 1 0 10 0"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.book}</svg>`;
  root.CourseBridgeIcons = {
    svg,
    hydrate(scope = document) {
      for (const element of scope.querySelectorAll("[data-icon]"))
        element.innerHTML = svg(element.dataset.icon);
    },
  };
})(globalThis);
