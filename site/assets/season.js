// /season/: the Season Pass. A week of every game as XP and a rank, the week's tournament and its champions
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const NAMES = { yard: 'The Yard', rugrun: 'Rug Run', bondgame: 'Will it bond?', race: 'Curve Racing', bingo: 'Launch Bingo', fantasy: 'Fantasy Launcher', sniper: 'Paper Sniper' };
const PATHS = { yard: '/play/', rugrun: '/rug-run/', bondgame: '/bond-game/', race: '/race/', bingo: '/bingo/', fantasy: '/fantasy/', sniper: '/sniper/' };
async function load(me = store.get('sd.bg.h') || '') {
  if (me) $('#ss-h').value = me;
  let v = null; try { v = await api('season?me=' + encodeURIComponent(me)); } catch (e) {} if (!v?.ok) return;
  const m = v.me, R = v.ranks, next = m ? R.find(r => r.xp > m.xp) : R[1];
  $('#ss-xp').textContent = m ? m.xp.toLocaleString('en-US') : '0'; $('#ss-xp-s').textContent = m ? (m.holder ? 'holder league · 1.2 times' : 'this week') : me ? 'no play this week yet' : 'type your handle below';
  $('#ss-rank').textContent = m ? m.rank : 'Rookie'; $('#ss-rank-s').textContent = next ? `${(next.xp - (m?.xp || 0)).toLocaleString('en-US')} XP to ${next.name}` : 'the top rank';
  $('#ss-tour').innerHTML = `<a href="${v.tournament.path}">${esc(v.tournament.name)}</a>`; $('#ss-tour-s').textContent = 'this week\'s tournament';
  $('#ss-end').textContent = new Date(v.ends).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  $('#ss-games').innerHTML = Object.keys(NAMES).map(k => { const p = m?.games?.[k]; return `<p><a href="${PATHS[k]}">${NAMES[k]}</a> · ${p ? '<b>' + Math.round(p) + '</b> points' : '<span class="s">not played this week</span>'}</p>`; }).join('');
  $('#ss-t-s').textContent = `${v.tournament.name} · the winner is named in the Telegram group on Monday`;
  $('#ss-t').innerHTML = v.tournament.leaders.length ? v.tournament.leaders.map((b, i) => `<p>${i + 1}. ${esc(b.handle)} · <b>${b.pts}</b></p>`).join('') : `<p>Nobody has played <a href="${v.tournament.path}">${esc(v.tournament.name)}</a> this week yet.</p>`;
  $('#ss-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)}${b.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${b.xp.toLocaleString('en-US')}</b> XP · ${b.rank}</p>`).join('') : '<p>Nobody has played this week yet.</p>';
  $('#ss-champs').innerHTML = v.champions.length ? v.champions.map(c => `<p>Week of ${c.week} · ${esc(c.game)} · <b>${esc(c.handle)}</b> with ${c.pts}</p>`).join('') : '<p>The first tournament is still running.</p>';
  $('#ss-note').textContent = v.note;
}
$('#ss-form').addEventListener('submit', e => { e.preventDefault(); const h = $('#ss-h').value.trim().toLowerCase(); if (/^[a-z0-9_]{2,16}$/.test(h)) { store.set('sd.bg.h', h); load(h); } });
load(); setInterval(load, 120000);
