// /holder/: ties the wallet that holds $SHUNT to a chat with the bot, by one personal_sign signature
import { createYard } from './yard.js';
import { mountChrome, $ } from './ui.js';

mountChrome('');
createYard($('#yard'), { ambient: true });
const code = new URLSearchParams(location.search).get('c') || '', n0 = v => Math.round(v).toLocaleString('en-US');
const hex = s => '0x' + [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

async function start() {
  let info = null; try { info = await (await fetch('/api/holder?c=' + encodeURIComponent(code))).json(); } catch (e) {}
  if (info?.ok) { $('#hd-trip').textContent = info.trip + ' tokens'; $('#hd-boost').textContent = n0(info.boost) + ' $SHUNT'; $('#hd-min').innerHTML = `<p>Holder: ${n0(info.min)} $SHUNT. Pro: ${n0(info.pro || 5000000)} $SHUNT. Read from the linked wallet again every few hours. Tokens in a pool or still on the way do not count.</p>`; }
  if (!/^[0-9a-f]{10}$/.test(code)) return;
  $('#hd-state').textContent = 'the message you will sign';
  $('#hd-body').innerHTML = '<p>Your wallet will show this exact message. Signing it proves the wallet is yours; nothing is sent and nothing is spent.</p>';
  $('#hd-msg').hidden = false; $('#hd-msg').textContent = info?.message || '';
  $('#hd-go').hidden = false;
  // no wallet in this browser (Telegram's own browser has none): say so up front, with the link to copy
  if (!window.ethereum) {
    $('#hd-out').innerHTML = 'NO WALLET IN THIS BROWSER. COPY THIS LINK AND OPEN IT IN THE BROWSER WHERE YOUR WALLET IS (A WALLET EXTENSION, OR THE BROWSER INSIDE YOUR WALLET APP). <button class="btn ghost" id="hd-copy" type="button" style="margin-top:10px">Copy the link</button>';
    $('#hd-out').style.color = '#ff7a3d';
    $('#hd-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); $('#hd-copy').textContent = 'Copied'; } catch (e) { $('#hd-copy').textContent = location.href; } });
  }
}
$('#hd-go').addEventListener('click', async () => {
  const eth = window.ethereum, out = $('#hd-out');
  if (!eth) { out.textContent = 'NO WALLET FOUND IN THIS BROWSER. OPEN THE LINK IN YOUR WALLET APP\'S BROWSER, OR A BROWSER WITH A WALLET EXTENSION.'; return; }
  try {
    $('#hd-go').disabled = true; out.textContent = 'CONNECT THE WALLET…';
    const [addr] = await eth.request({ method: 'eth_requestAccounts' });
    out.textContent = 'SIGN THE MESSAGE IN YOUR WALLET…';
    const sig = await eth.request({ method: 'personal_sign', params: [hex($('#hd-msg').textContent), addr] });
    out.textContent = 'CHECKING THE SIGNATURE AND THE BALANCE…';
    const r = await (await fetch('/api/holder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, address: addr, sig }) })).json();
    out.textContent = r.ok ? (r.holder ? `LINKED: ${n0(r.balance)} $SHUNT. THE HOLDER TOOLS ARE ON; THE BOT HAS SENT YOU THE DETAILS.` : `LINKED, BUT THE WALLET HOLDS ${n0(r.balance)} $SHUNT. THE HOLDER TOOLS OPEN AT ${n0(r.min)}.`) : String(r.why || 'not answering right now').toUpperCase() + '.';
  } catch (e) { out.textContent = (e?.code === 4001 ? 'CANCELLED IN THE WALLET.' : 'THE WALLET DID NOT ANSWER: ' + String(e?.message || e).slice(0, 120)).toUpperCase(); }
  $('#hd-go').disabled = false;
});
start();
