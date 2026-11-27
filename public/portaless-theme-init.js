// A-07: externalized from BaseLayout.astro so script-src stays 'self' without
// 'unsafe-inline'. Applies stored light/dark preference before first paint and
// synchronizes dual-mode ThemePacks (data-theme-light / data-theme-dark) so a
// page theme never blocks the visitor's Claro/Oscuro toggle.
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem("portaless-theme");
    if (t === "dark" || t === "light") root.setAttribute("data-theme", t);
  } catch (e) { /* sin storage: auto */ }

  var lightMeta = document.querySelector('meta[name="portaless-theme-light"]');
  var darkMeta = document.querySelector('meta[name="portaless-theme-dark"]');
  var lightCss = lightMeta ? lightMeta.getAttribute("content") : null;
  var darkCss = darkMeta ? darkMeta.getAttribute("content") : null;
  if (!lightCss && !darkCss) return;

  var mq = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function applyDualTheme() {
    var attr = root.getAttribute("data-theme");
    var isDark = attr === "dark" || (attr !== "light" && Boolean(mq && mq.matches));
    var css = isDark ? (darkCss || lightCss) : (lightCss || darkCss);
    if (css) root.setAttribute("style", css);
  }

  applyDualTheme();

  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", applyDualTheme);
  }
  if (typeof MutationObserver === "function") {
    new MutationObserver(applyDualTheme).observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
})();
