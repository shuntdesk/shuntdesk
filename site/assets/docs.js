// the docs: the plain page chrome, plus a contents list that follows the reader
import './plain.js';

const links = [...document.querySelectorAll('#toc a')], toc = document.getElementById('toc');
const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
const seen = new Set();
const io = new IntersectionObserver(es => {
  for (const e of es) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
  const first = [...byId.keys()].find(id => seen.has(id));
  if (!first) return;
  for (const a of links) a.classList.toggle('on', a === byId.get(first));
}, { rootMargin: '-90px 0px -60% 0px' });
for (const id of byId.keys()) { const s = document.getElementById(id); if (s) io.observe(s); }
// on a phone the contents fold away once a section is picked
toc.addEventListener('click', e => { if (e.target.closest('a') && matchMedia('(max-width: 900px)').matches) toc.querySelector('details').open = false; });
if (matchMedia('(max-width: 900px)').matches) toc.querySelector('details').open = false;
