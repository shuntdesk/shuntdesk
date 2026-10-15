// pages that are only words: the header, the footer, the yard behind them
import { createYard } from './yard.js';
import { mountChrome, $, feedYard } from './ui.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
