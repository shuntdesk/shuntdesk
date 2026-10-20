// The share card: an SVG drawn from a token's reads, turned into a PNG in the Worker (resvg, MPL-2.0) so X, Telegram
// and others can show it as a link preview. Loaded only when a card is asked for, so the rest of the Worker stays light.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import bsd from './fonts/bsd-900.ttf';
import barlow from './fonts/barlow-500.ttf';
import jbm from './fonts/jbm-700.ttf';

let ready = null;
const fonts = [bsd, barlow, jbm].map(b => new Uint8Array(b));
export async function svgToPng(svg) {
  ready = ready || initWasm(wasm);
  await ready;
  return new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Barlow' }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
