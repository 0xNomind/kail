// The game's music: one calm piece that goes round and round, quietly, under the sea. No other sounds.
//
// A browser lets a page make sound only after the player has touched it, so the music starts with the first press
// or key. A button turns it off and on, and the choice is remembered. It stops while the game is not on screen.
//
// The piece is cut to go round without a seam (its end is blended into its start). To keep it seamless here it is
// decoded once and played from memory, where a loop is exact to the sample; an <audio> element would leave a
// small gap at every turn. Some formats add a breath of silence at the edges: that is found and left out.
const FILES = [['audio/ogg; codecs="vorbis"', 'public/music/sea.ogg'], ['audio/mpeg', 'public/music/sea.mp3']];
const VOLUME = 0.45, SLOT = 'kail.music';

let ctx = null, gain = null, source = null, loading = null, wanted = true, started = false;
try { wanted = localStorage.getItem(SLOT) !== 'off'; } catch { /* private mode: on, for this visit */ }

// the first of the files this browser can play
function file() {
  const probe = document.createElement('audio');
  return (FILES.find(([type]) => probe.canPlayType(type)) || FILES[FILES.length - 1])[1];
}
// where the sound really begins and ends, in seconds (silence at the edges, up to a fifth of a second, is left out)
function edges(buffer) {
  const data = buffer.getChannelData(0), most = Math.floor(buffer.sampleRate * 0.2), quiet = 0.002;
  let a = 0, b = data.length - 1;
  while (a < most && Math.abs(data[a]) < quiet) a += 1;
  while (b > data.length - most && Math.abs(data[b]) < quiet) b -= 1;
  return [a / buffer.sampleRate, (b + 1) / buffer.sampleRate];
}
async function play() {
  if (source || !ctx) return;
  loading ||= fetch(file()).then((r) => { if (!r.ok) throw new Error('no music file'); return r.arrayBuffer(); }).then((bytes) => ctx.decodeAudioData(bytes));
  let buffer;
  try { buffer = await loading; } catch { loading = null; return; }      // no music is not a reason to stop a game
  if (source || !wanted) return;
  const [from, to] = edges(buffer);
  source = ctx.createBufferSource();
  source.buffer = buffer; source.loop = true; source.loopStart = from; source.loopEnd = to;
  source.connect(gain);
  // it comes in softly
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 2.5);
  source.start(0, from);
}
function stop() {
  if (!source) return;
  const old = source; source = null;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  setTimeout(() => { try { old.stop(); } catch { /* it had stopped */ } }, 450);
}
// the first touch: now the browser lets the page make sound
function begin() {
  if (started) return;
  started = true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  ctx = new Ctx();
  gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
  if (wanted) play();
}

/// Sets the music up for a page. `button` shows and switches it: it gets the class "off" and aria-pressed.
export function music(button) {
  const show = () => { if (button) { button.classList.toggle('off', !wanted); button.setAttribute('aria-pressed', String(wanted)); button.title = wanted ? 'Music is on. Press to turn it off.' : 'Music is off. Press to turn it on.'; } };
  show();
  for (const kind of ['pointerdown', 'keydown']) window.addEventListener(kind, begin, { once: true, capture: true });
  button?.addEventListener('click', () => {
    wanted = !wanted;
    try { localStorage.setItem(SLOT, wanted ? 'on' : 'off'); } catch { /* not remembered then */ }
    show();
    begin();
    if (!ctx) return;
    if (wanted) { ctx.resume(); play(); } else stop();
  });
  // quiet while the game is not on screen
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (wanted) ctx.resume(); });
}
