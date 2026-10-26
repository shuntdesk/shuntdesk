// /bot/: put Shunt in your group, and how many groups it is in
import { createYard } from './yard.js';
import { mountChrome, $, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
(async () => { try { const v = await api('botgroups'); if (v?.ok && v.groups) $('#bt-n').textContent = `IN ${v.groups} GROUP${v.groups > 1 ? 'S' : ''} SO FAR · ${v.active7d} ASKED IT THIS WEEK`; } catch (e) {} })();
