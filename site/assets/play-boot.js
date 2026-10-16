// any error shows here, so a phone can report it in a screenshot
// the loading screen: a bar that creeps toward the next milestone, then a fade into the city
window.boot = (k, msg) => { const u = document.getElementById('bootbar'), m = document.getElementById('bootmsg'); if (u) u.style.width = Math.round(k * 100) + '%'; if (msg && m) m.textContent = msg; };
window.bootDone = () => { window.boot(1, 'Ready'); setTimeout(() => { document.getElementById('boot').classList.add('done'); document.body.classList.remove('booting'); }, 250); };
window.boot(0.12, 'Building the city');
window.showErr = e => { const el = document.getElementById('err'); el.hidden = false; el.textContent = 'Error: ' + (e && (e.message || e.reason?.message || e)) + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : ''); };
addEventListener('error', e => window.showErr(e.error || e.message));
addEventListener('unhandledrejection', e => window.showErr(e.reason));
