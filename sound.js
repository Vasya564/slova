// Тихі звуки гри. Контекст створюємо ліниво — лише після першого дотику до сітки.

let context = null

function audio() {
  if (!context) context = new AudioContext()
  if (context.state === 'suspended') context.resume()
  return context
}

function note(frequency, delay, duration, peak) {
  const ctx = audio()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const at = ctx.currentTime + delay

  osc.type = 'triangle'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

const TUNES = {
  found: [[659, 0, 0.18, 0.07], [988, 0.07, 0.22, 0.05]],
  miss: [[196, 0, 0.14, 0.035]],
  secret: [[784, 0, 0.16, 0.06], [1047, 0.08, 0.18, 0.05], [1319, 0.16, 0.3, 0.045]],
  level: [[523, 0, 0.16, 0.06], [659, 0.09, 0.16, 0.055], [880, 0.18, 0.32, 0.05]],
}

export function play(tune) {
  try {
    for (const [frequency, delay, duration, peak] of TUNES[tune]) {
      note(frequency, delay, duration, peak)
    }
  } catch {
    // звук — не те, заради чого варто ламати гру
  }
}
