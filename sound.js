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
// Для кожного звуку — список файлів: перший, який знайдеться, той і грає.
const SAMPLES = {
  error: ['error.m4a'],
  roller: ['roller.m4a'],
  splat: ['splat.m4a', 'splat.mp3', 'splat.wav'],
}

const decoded = new Map()
const loading = new Map()

async function load(name) {
  for (const file of SAMPLES[name]) {
    try {
      const response = await fetch(file)
      if (!response.ok) continue
      const buffer = await audio().decodeAudioData(await response.arrayBuffer())
      decoded.set(name, buffer)
      return buffer
    } catch {
      // не той файл або не той формат — пробуємо наступний
    }
  }
  decoded.set(name, null)
  return null
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

    // сам шльопок: широкий шум, що миттю глухне
    const hit = ctx.createBufferSource()
    hit.buffer = noiseBuffer(ctx)
    const hitFilter = ctx.createBiquadFilter()
    hitFilter.type = 'lowpass'
    hitFilter.frequency.setValueAtTime(5200, now)
    hitFilter.frequency.exponentialRampToValueAtTime(300, now + 0.13)
    hitFilter.Q.value = 1.4
    const hitGain = ctx.createGain()
    hitGain.gain.setValueAtTime(0.0001, now)
    hitGain.gain.exponentialRampToValueAtTime(0.26, now + 0.004)
    hitGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17)
    hit.connect(hitFilter).connect(hitGain).connect(ctx.destination)
    hit.start(now, Math.random())
    hit.stop(now + 0.2)

    // дрібні бризки навздогін
    for (let i = 0; i < 4; i++) {
      const drop = ctx.createBufferSource()
      drop.buffer = noiseBuffer(ctx)
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 900 + Math.random() * 2200
      band.Q.value = 3
      const gain = ctx.createGain()
      const at = now + 0.05 + Math.random() * 0.16
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.03, at + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
      drop.connect(band).connect(gain).connect(ctx.destination)
      drop.start(at, Math.random())
      drop.stop(at + 0.08)
    }
  } catch {
    // тиха ляпка
  }
}

// Розрив паперу: шурхіт із дрібними тріщинками, що наростає.
export function tear() {
  try {
    const ctx = audio()
    const now = ctx.currentTime

    const rip = ctx.createBufferSource()
    rip.buffer = noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1300, now)
    filter.frequency.linearRampToValueAtTime(3300, now + 0.78)
    filter.Q.value = 0.9
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.085, now + 0.62)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
    rip.connect(filter).connect(gain).connect(ctx.destination)
    rip.start(now, Math.random())
    rip.stop(now + 1)

    // окремі волокна, що лопаються
    for (let i = 0; i < 11; i++) {
      const snap = ctx.createBufferSource()
      snap.buffer = noiseBuffer(ctx)
      const band = ctx.createBiquadFilter()
      band.type = 'highpass'
      band.frequency.value = 2200 + Math.random() * 2600
      const tick = ctx.createGain()
      const at = now + 0.05 + Math.random() * 0.75
      tick.gain.setValueAtTime(0.0001, at)
      tick.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.025, at + 0.003)
      tick.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
      snap.connect(band).connect(tick).connect(ctx.destination)
      snap.start(at, Math.random())
      snap.stop(at + 0.06)
    }
  } catch {
    // тихий розрив
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
