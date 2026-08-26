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

// Записані звуки: валик і помилка. Кожен вантажимо раз і тримаємо
// розкодованим; якщо файлу немає — лишається синтез.
const SAMPLES = { error: 'error.m4a', roller: 'roller.m4a', splat: 'splat.m4a' }

const decoded = new Map()
const loading = new Map()

async function load(name) {
  try {
    const response = await fetch(SAMPLES[name])
    if (!response.ok) throw new Error(response.status)
    const buffer = await audio().decodeAudioData(await response.arrayBuffer())
    decoded.set(name, buffer)
    return buffer
  } catch {
    decoded.set(name, null)
    return null
  }
}

function sample(name) {
  if (decoded.has(name)) return Promise.resolve(decoded.get(name))
  if (!loading.has(name)) loading.set(name, load(name))
  return loading.get(name)
}

function playSample(buffer, volume, seconds) {
  const ctx = audio()
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.buffer = buffer
  source.connect(gain).connect(ctx.destination)

  if (!seconds) {
    source.start()
    return
  }

  // обрізаємо семпл під довжину проходу і прибираємо хвіст, щоб не клацнуло
  const now = ctx.currentTime
  gain.gain.setValueAtTime(volume, now + Math.max(0, seconds - 0.09))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
  source.start(now, 0, seconds + 0.02)
}

// Металевий призвук дає частотна модуляція несумірним відношенням:
// модулятор на 1.41 від несучої розкладається на негармонійні обертони.
function bell(frequency, delay, duration, peak) {
  const ctx = audio()
  const at = ctx.currentTime + delay
  const carrier = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const index = ctx.createGain()
  const gain = ctx.createGain()

  carrier.frequency.value = frequency
  modulator.frequency.value = frequency * 1.41
  index.gain.setValueAtTime(frequency * 1.7, at)
  index.gain.exponentialRampToValueAtTime(frequency * 0.04, at + duration * 0.55)

  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  modulator.connect(index).connect(carrier.frequency)
  carrier.connect(gain).connect(ctx.destination)
  modulator.start(at)
  carrier.start(at)
  modulator.stop(at + duration + 0.05)
  carrier.stop(at + duration + 0.05)
}

async function timeIsUp() {
  const buffer = await sample('error')
  if (buffer) {
    playSample(buffer, 0.9)
    return
  }
  bell(659.25, 0, 0.6, 0.09)
  bell(493.88, 0.19, 0.85, 0.085)
}

const TUNES = {
  found: [[659, 0, 0.18, 0.07], [988, 0.07, 0.22, 0.05]],
  miss: [[196, 0, 0.14, 0.035]],
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

// Готуємо дзвін заздалегідь: інакше перше «час вийшов» мовчить,
// поки вантажиться й розкодовується файл.
export function primeSounds() {
  sample('error')
  sample('roller')
  sample('splat')
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

// Валик: записаний проїзд, а якщо файлу немає — широкий низький шурхіт.
export async function paintRoll(seconds) {
  const buffer = await sample('roller')
  if (buffer) {
    playSample(buffer, 0.75, seconds)
    return
  }
  rollSynth(seconds ?? 1)
}

function rollSynth(seconds) {
  try {
    const ctx = audio()
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    source.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    filter.Q.value = 0.8

    const gain = ctx.createGain()
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.12)
    gain.gain.setValueAtTime(0.07, now + seconds * 0.7)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)

    source.connect(filter).connect(gain).connect(ctx.destination)
    source.start(now)
    source.stop(now + seconds + 0.05)
  } catch {
    // тиша теж фарбує
  }
}

// Ляпка: записаний звук, якщо є файл, інакше вологий удар власного розливу.
export async function splash() {
  const buffer = await sample('splat')
  if (buffer) {
    playSample(buffer, 0.9)
    return
  }
  splashSynth()
}

function splashSynth() {
  try {
    const ctx = audio()
    const now = ctx.currentTime

    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(3400, now)
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.22)
    const wet = ctx.createGain()
    wet.gain.setValueAtTime(0.0001, now)
    wet.gain.exponentialRampToValueAtTime(0.2, now + 0.006)
    wet.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    source.connect(filter).connect(wet).connect(ctx.destination)
    source.start(now, Math.random())
    source.stop(now + 0.26)

    const thud = ctx.createOscillator()
    const body = ctx.createGain()
    thud.frequency.setValueAtTime(210, now)
    thud.frequency.exponentialRampToValueAtTime(52, now + 0.18)
    body.gain.setValueAtTime(0.0001, now)
    body.gain.exponentialRampToValueAtTime(0.16, now + 0.008)
    body.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    thud.connect(body).connect(ctx.destination)
    thud.start(now)
    thud.stop(now + 0.28)
  } catch {
    // тиха ляпка
  }
}

// Хрускіт паперу на кожен крок жмакання.
export function crumple(step) {
  try {
    const ctx = audio()
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 900 + step * 350

    const gain = ctx.createGain()
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05 + step * 0.012, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

    source.connect(filter).connect(gain).connect(ctx.destination)
    source.start(now, Math.random())
    source.stop(now + 0.2)
  } catch {
    // без хрускоту теж мнеться
  }
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
    if (tune === 'timeout') {
      timeIsUp()
      return
    }
    for (const [frequency, delay, duration, peak, type] of TUNES[tune]) {
      note(frequency, delay, duration, peak, type)
    }
  } catch {
    // звук — не те, заради чого варто ламати гру
  }
}
