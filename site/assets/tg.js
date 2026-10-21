// /tg/: the Telegram mini app's hub. A pasted token goes to its ticket
document.getElementById('f').addEventListener('submit', e => { e.preventDefault(); const a = document.getElementById('a').value.trim().toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(a)) location.href = '/ticket/?a=' + a; else document.getElementById('a').value = ''; });
