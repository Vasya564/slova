// Тихі звуки гри. Контекст створюємо ліниво — лише після першого дотику до сітки.

let context = null

function audio() {
  if (!context) context = new AudioContext()
  if (context.state === 'suspended') context.resume()
  return context
}

function note(frequency, delay, duration, peak, type = 'triangle') {
  const ctx = audio()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const at = ctx.currentTime + delay

  osc.type = type
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

// Кінець часу дзвонить на манер windows xp: два дзвінких тони, другий нижчий,
// плюс тихі верхні обертони для металевого призвуку. Це власна імітація —
// оригінальний файл Microsoft у відкриту сторінку класти не можна.
const XP_ERROR = [
  [659.25, 0, 0.34, 0.085, 'sine'],
  [1318.5, 0, 0.16, 0.03, 'sine'],
  [493.88, 0.17, 0.46, 0.08, 'sine'],
  [987.77, 0.17, 0.2, 0.028, 'sine'],
]

const TUNES = {
  found: [[659, 0, 0.18, 0.07], [988, 0.07, 0.22, 0.05]],
  miss: [[196, 0, 0.14, 0.035]],
  timeout: XP_ERROR,
  secret: [[784, 0, 0.16, 0.06], [1047, 0.08, 0.18, 0.05], [1319, 0.16, 0.3, 0.045]],
  level: [[523, 0, 0.16, 0.06], [659, 0.09, 0.16, 0.055], [880, 0.18, 0.32, 0.05]],
}

// Шурхіт пензля: закільцьований шум крізь смуговий фільтр. Тримається,
// поки ведеш, і озивається голосніше на кожній новій літері.
let noise = null
let paint = null

function noiseBuffer(ctx) {
  if (noise) return noise
  const seconds = 1.5
  noise = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const channel = noise.getChannelData(0)
  for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1
  return noise
}

export function paintStart() {
  if (paint) return
  try {
    const ctx = audio()
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    source.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1700
    filter.Q.value = 0.6

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.02, ctx.currentTime + 0.06)

    source.connect(filter).connect(gain).connect(ctx.destination)
    source.start()
    paint = { ctx, source, gain, filter }
  } catch {
    // без шурхоту теж можна малювати
  }
}

export function paintStroke() {
  if (!paint) return
  const { ctx, gain, filter } = paint
  const now = ctx.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.018, now + 0.16)
  filter.frequency.setTargetAtTime(1450 + Math.random() * 700, now, 0.05)
}

export function paintStop() {
  if (!paint) return
  const { ctx, source, gain } = paint
  paint = null
  const now = ctx.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  source.stop(now + 0.14)
}

export function play(tune) {
  try {
    for (const [frequency, delay, duration, peak, type] of TUNES[tune]) {
      note(frequency, delay, duration, peak, type)
    }
  } catch {
    // звук — не те, заради чого варто ламати гру
  }
}
