// Two looks: the Yard UI (the 3D night yard, the cards) and Simple UI (the clean terminal, dark or light). The choice is kept in this
// browser and set before the page paints, so it never flashes the other look. The simple landing lives at /simple/.
(function () {
  var simple = false;
  try { simple = localStorage.getItem('sd.ui') === 'simple'; } catch (e) {}
  var p = location.pathname, sol = /^sol\./.test(location.hostname);
  // the Solana side: sol.shuntdesk.com, in Solana's purple and green
  if (sol) document.documentElement.classList.add('sol');
  if (p === '/simple/' || p === '/simple') simple = true;
  if (simple) document.documentElement.classList.add('simple');
  // the light theme belongs to Simple UI; the Yard UI is a night yard and stays dark
  try { if (simple && localStorage.getItem('sd.theme') === 'light') document.documentElement.classList.add('light'); } catch (e) {}
  if (simple && !sol && p === '/' && !/[?&]full\b/.test(location.search)) location.replace('/simple/' + location.search);
})();
