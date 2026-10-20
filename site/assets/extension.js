// /extension/: the install page
import { createYard } from './yard.js';
import { mountChrome, $ } from './ui.js';

mountChrome('');
createYard($('#yard'), { ambient: true });
