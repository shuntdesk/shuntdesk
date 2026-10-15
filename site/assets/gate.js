// Runs before the page paints. A visitor who has already come through the doors in this visit, and the
// screenshot tests, go straight in: the stylesheet hides the doors when <html> carries the class "in".
// Everyone else is "gated" from the first paint, so the page behind the doors never flashes through on load.
(function () {
  var root = document.documentElement, inside = false;
  try { inside = /[?&]snap/.test(location.search) || !!sessionStorage.getItem('sd.in'); } catch (e) {}
  // "boot" keeps the landing panels hidden until the first frame has placed them (home.js removes it)
  root.classList.add(inside ? 'in' : 'gated', 'boot');
})();
