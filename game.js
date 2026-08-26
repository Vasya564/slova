import { EMOJI, LEVELS, buildPuzzle, label, levelSeconds, readPath, reverse } from './puzzle.js'
import { crumple, paintRoll, paintStart, paintStop, paintStroke, play, primeSounds, splash } from './sound.js'

const MARKERS = ['--m1', '--m2', '--m3', '--m4', '--m5', '--m6', '--m7', '--m8']
const ALL_WORDS = LEVELS.flatMap((level) => level.words)
const COLOR = new Map(ALL_WORDS.map((word, i) => [word, `var(${MARKERS[i % MARKERS.length]})`]))
const SECRET_COLOR = secretColor()
const PROGRESS_KEY = 'slova:passed'

// Кольори по колу, тож секрету віддаємо той, якого немає серед слів його рівня.
function secretColor() {
  const level = LEVELS.find((lvl) => lvl.secret)
  const used = new Set(level ? level.words.map((word) => COLOR.get(word)) : [])
  return MARKERS.map((marker) => `var(${marker})`).find((color) => !used.has(color))
}

const el = {
  intro: document.getElementById('intro'),
  game: document.getElementById('game'),
  finale: document.getElementById('finale'),
  levels: document.getElementById('levels'),
  sheet: document.getElementById('sheet'),
  roller: document.getElementById('roller'),
  grid: document.getElementById('grid'),
  gridWrap: document.querySelector('.grid-wrap'),
  marks: document.getElementById('marks'),
  words: document.getElementById('words'),
  tally: document.getElementById('tally'),
  note: document.getElementById('note'),
  hint: document.getElementById('hint'),
  clockLine: document.getElementById('clock-line'),
  drain: document.getElementById('drain'),
  clock: document.getElementById('clock'),
  card: document.getElementById('card'),
  cardTitle: document.getElementById('card-title'),
  cardText: document.getElementById('card-text'),
  cardClose: document.getElementById('card-close'),
  curtain: document.getElementById('curtain'),
  curtainTitle: document.getElementById('curtain-title'),
  curtainNote: document.getElementById('curtain-note'),
  next: document.getElementById('next'),
  collected: document.getElementById('collected'),
  announce: document.getElementById('announce'),
}

const state = {
  levelIndex: 0,
  puzzle: null,
  cells: [],
  found: new Map(),
  drawn: new Set(),
  selection: null,
  anchor: null,
  dragging: false,
  secret: null,
  hintPresses: 0,
  hint: null,
  hintTimer: 0,
  afterCard: null,
  deadline: 0,
  remaining: 0,
  ticker: 0,
}

const level = () => LEVELS[state.levelIndex]

/* ---------- прогрес ---------- */

function passedLevels() {
  const raw = Number(localStorage.getItem(PROGRESS_KEY))
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 0), LEVELS.length) : 0
}

function rememberPassed(count) {
  try {
    localStorage.setItem(PROGRESS_KEY, String(count))
  } catch {
    // приватний режим — прогрес просто не збережеться
  }
}

/* ---------- малювання ---------- */

function showScreen(name) {
  for (const screen of [el.intro, el.game, el.finale]) {
    screen.toggleAttribute('data-active', screen.id === name)
  }
}

function renderPips(done = state.levelIndex, current = state.levelIndex) {
  el.levels.replaceChildren(
    ...LEVELS.map((lvl, i) => {
      const pip = document.createElement('span')
      pip.className = 'pip'
      pip.textContent = String(lvl.id)
      if (i < done) pip.dataset.state = 'done'
      if (i === current) pip.dataset.state = 'current'
      return pip
    })
  )
}

function renderWords() {
  el.words.replaceChildren(
    ...level().words.map((word) => {
      const item = document.createElement('span')
      item.className = 'word'
      item.textContent = label(word)
      item.style.setProperty('--c', COLOR.get(word))
      item.dataset.word = word
      if (state.found.has(word)) item.dataset.found = ''
      return item
    })
  )
  el.tally.textContent = `${state.found.size} з ${level().words.length}`
}

function renderGrid() {
  const { size, grid } = state.puzzle
  el.grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`
  el.sheet.style.setProperty('--span', `${size * 56}px`)
  state.cells = []

  const cells = []
  for (let r = 0; r < size; r++) {
    state.cells[r] = []
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('span')
      cell.className = 'cell'
      cell.textContent = grid[r][c]
      cell.dataset.r = String(r)
      cell.dataset.c = String(c)
      state.cells[r][c] = cell
      cells.push(cell)
    }
  }
  el.grid.replaceChildren(...cells)
}

function syncCellSize() {
  const width = el.grid.clientWidth
  if (!width) return
  el.grid.style.setProperty('--cell', `${width / state.puzzle.size}px`)
  el.marks.setAttribute('viewBox', `0 0 ${width} ${el.grid.clientHeight}`)
}

function centerOf({ r, c }) {
  const cell = state.cells[r][c].getBoundingClientRect()
  const grid = el.grid.getBoundingClientRect()
  return {
    x: cell.left - grid.left + cell.width / 2,
    y: cell.top - grid.top + cell.height / 2,
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const BRUSH_SEGMENT = 9

function svg(tag) {
  return document.createElementNS(SVG_NS, tag)
}

// Той самий мазок при кожному перемальовуванні: зерно рахуємо з координат слова.
function seedOf(cells) {
  const first = cells[0]
  const last = cells[cells.length - 1]
  return (first.r * 31 + first.c) * 977 + last.r * 31 + last.c + cells.length
}

function noise(seed) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Ширина мазка вздовж штриха: різко лягає, довго сходить нанівець,
// плюс дрібні коливання — ніби змінюється натиск руки.
function pressure(t) {
  const lands = Math.min(1, t / 0.05)
  const lifts = Math.min(1, (1 - t) / 0.12)
  return Math.sqrt(Math.min(lands, lifts)) * (0.88 + 0.12 * Math.sin(t * 8.5 + 1.1))
}

// Мазок трохи вигинається: кінці лишаються на літерах, середина відходить убік.
function bow(t, arc) {
  return arc * Math.sin(Math.PI * t)
}

function ribbon(points) {
  const upper = points.map(([x, y, w]) => `${x.toFixed(1)},${(y - w).toFixed(1)}`)
  const lower = points.map(([x, y, w]) => `${x.toFixed(1)},${(y + w).toFixed(1)}`).reverse()
  return `M${upper.join('L')}L${lower.join('L')}Z`
}

// Щільне тіло мазка.
function brushBody(length, half, arc, random) {
  const steps = Math.min(40, Math.max(10, Math.round(length / BRUSH_SEGMENT)))
  const points = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const wobble = (random() - 0.5) * half * 0.24
    points.push([t * length, bow(t, arc) + wobble, half * pressure(t) * 0.86])
  }

  return ribbon(points)
}

// Волосини щетини: тонкі пасма поперек ширини. Між ними просвічує папір,
// а найдовші тягнуться далі за тіло — саме це й робить мазок сухим.
function brushBristles(length, half, arc, random) {
  const strands = 8
  const paths = []

  for (let i = 0; i < strands; i++) {
    const across = (i / (strands - 1)) * 2 - 1
    const offset = across * half * 0.72
    const thick = half * (0.3 - 0.18 * Math.abs(across)) * (0.7 + random() * 0.6)
    const from = length * random() * 0.1
    const to = Math.min(length * 1.16, length * (0.78 + random() * 0.38))
    const drift = (random() - 0.5) * half * 0.55
    const points = []

    for (let step = 0; step <= 6; step++) {
      const t = step / 6
      const x = from + (to - from) * t
      const taper = Math.min(1, (1 - t) / 0.35) * Math.min(1, (t + 0.25) / 0.3)
      points.push([x, offset + bow(x / length, arc) + drift * t, Math.max(0.35, thick * taper)])
    }

    paths.push(ribbon(points))
  }

  return paths.join('')
}

function fill(d, color, opacity) {
  const path = svg('path')
  path.setAttribute('d', d)
  path.setAttribute('fill', color)
  path.setAttribute('opacity', opacity)
  return path
}

// Мазок від центру першої літери до центру останньої, з невеликим виходом за них.
function brush(cells, color, half, opacity) {
  const a = centerOf(cells[0])
  const b = centerOf(cells[cells.length - 1])
  const span = Math.hypot(b.x - a.x, b.y - a.y)
  const ux = span ? (b.x - a.x) / span : 1
  const uy = span ? (b.y - a.y) / span : 0
  const pad = half * 0.95
  const length = span + pad * 2
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI
  const random = noise(seedOf(cells))
  const arc = (random() - 0.5) * half * 0.45

  const group = svg('g')
  group.setAttribute('transform', `translate(${a.x - ux * pad} ${a.y - uy * pad}) rotate(${angle})`)

  const layers = svg('g')
  layers.setAttribute('filter', 'url(#brush)')
  layers.append(
    fill(brushBody(length, half, arc, random), color, opacity),
    fill(brushBristles(length, half, arc, random), color, opacity * 0.7)
  )
  group.append(layers)

  return { group, layers, length, half }
}

// Мазок «наноситься» зліва направо: прямокутник відсікання росте вздовж штриха.
function paintOn(mark, id) {
  const clip = svg('clipPath')
  clip.setAttribute('id', id)
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse')

  const window_ = svg('rect')
  window_.setAttribute('x', -mark.half * 2)
  window_.setAttribute('y', -mark.half * 2)
  window_.setAttribute('height', mark.half * 4)
  window_.setAttribute('width', 0)
  clip.append(window_)

  const inner = svg('g')
  inner.setAttribute('clip-path', `url(#${id})`)
  inner.append(mark.layers)
  mark.group.append(clip, inner)

  return () => {
    // Синхронний замір змушує браузер зафіксувати нульову ширину — без нього
    // переходу не буде. requestAnimationFrame тут не годиться: у фоновій
    // вкладці він мовчить.
    void window_.getBoundingClientRect()
    window_.style.transition = 'width 0.55s cubic-bezier(0.3, 0.8, 0.4, 1)'
    window_.setAttribute('width', mark.length * 1.2 + mark.half * 4)
  }
}

function drawMarks() {
  const cell = el.grid.clientWidth / state.puzzle.size
  const half = cell * 0.43
  const marks = []
  const starts = []

  for (const [word, cells] of state.found) {
    const mark = brush(cells, COLOR.get(word), half, 0.95)
    if (!state.drawn.has(word)) {
      state.drawn.add(word)
      starts.push(paintOn(mark, `paint-${state.drawn.size}`))
    }
    marks.push(mark.group)
  }

  if (state.secret) marks.push(brush(state.secret, SECRET_COLOR, half, 0.95).group)

  // Мазок під пальцем — той самий пензель, лише блідий
  if (state.selection) {
    marks.push(brush(state.selection, 'rgba(120, 114, 156, 0.3)', half * 0.94, 1).group)
  }

  el.marks.replaceChildren(...marks)
  for (const start of starts) start()
}

// Знайдене слово розсипає свій знак угору над сіткою.
function sparkle(word, cells) {
  const emoji = EMOJI[word]
  if (!emoji) return

  const size = el.grid.clientWidth / state.puzzle.size
  for (let i = 0; i < 6; i++) {
    const spot = centerOf(cells[Math.floor(Math.random() * cells.length)])
    const spark = document.createElement('span')
    spark.className = 'spark'
    spark.textContent = emoji
    spark.style.left = `${spot.x}px`
    spark.style.top = `${spot.y}px`
    spark.style.fontSize = `${size * 0.6}px`
    spark.style.animationDelay = `${i * 70}ms`
    spark.style.setProperty('--dx', `${(Math.random() - 0.5) * size * 2.4}px`)
    spark.style.setProperty('--rise', `${size * (1.8 + Math.random() * 1.2)}px`)
    spark.style.setProperty('--turn', `${(Math.random() - 0.5) * 60}deg`)
    spark.addEventListener('animationend', () => spark.remove())
    el.gridWrap.append(spark)
  }
}

/* ---------- виділення ---------- */

function cellAt(x, y) {
  const node = document.elementFromPoint(x, y)
  const cell = node instanceof Element ? node.closest('.cell') : null
  if (!cell || !el.grid.contains(cell)) return null
  return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) }
}

function pathBetween(from, to) {
  const dr = Math.sign(to.r - from.r)
  const dc = Math.sign(to.c - from.c)
  const steps = Math.max(Math.abs(to.r - from.r), Math.abs(to.c - from.c))
  const straight = from.r === to.r || from.c === to.c
  const diagonal = Math.abs(to.r - from.r) === Math.abs(to.c - from.c)
  if (!straight && !diagonal) return null
  return Array.from({ length: steps + 1 }, (_, i) => ({ r: from.r + dr * i, c: from.c + dc * i }))
}

function clearAnchor() {
  if (!state.anchor) return
  state.cells[state.anchor.r][state.anchor.c].removeAttribute('data-anchor')
  state.anchor = null
}

// Захоплення пальця/миші: без нього палець «губить» сітку, вийшовши за край.
function capture(pointerId) {
  try {
    el.grid.setPointerCapture(pointerId)
  } catch {
    // браузер не дав захоплення — виділення все одно працює по elementFromPoint
  }
}

function release(pointerId) {
  try {
    if (el.grid.hasPointerCapture(pointerId)) el.grid.releasePointerCapture(pointerId)
  } catch {
    // нічого захоплювати
  }
}

function startSelection(event) {
  const cell = cellAt(event.clientX, event.clientY)
  if (!cell) return
  event.preventDefault()
  const from = state.anchor && (state.anchor.r !== cell.r || state.anchor.c !== cell.c)
    ? state.anchor
    : cell
  state.dragging = true
  state.selection = pathBetween(from, cell) ?? [from]
  capture(event.pointerId)
  paintStart()
  drawMarks()
}

function extendSelection(event) {
  if (!state.dragging || !state.selection) return
  const cell = cellAt(event.clientX, event.clientY)
  if (!cell) return
  const path = pathBetween(state.selection[0], cell)
  if (!path) return
  const moved = path.length !== state.selection.length
  state.selection = path
  if (moved) paintStroke()
  drawMarks()
}

function endSelection(event) {
  if (!state.dragging || !state.selection) return
  state.dragging = false
  release(event.pointerId)
  paintStop()

  const path = state.selection
  state.selection = null

  // Один тап — ставимо якір, другий тап довершує слово. Так зручніше пальцем.
  if (path.length === 1 && !state.anchor) {
    state.anchor = path[0]
    state.cells[path[0].r][path[0].c].dataset.anchor = ''
    drawMarks()
    return
  }

  clearAnchor()
  if (!submit(path) && path.length > 1) miss()
  drawMarks()
}

function miss() {
  play('miss')
  el.gridWrap.removeAttribute('data-miss')
  void el.gridWrap.offsetWidth
  el.gridWrap.setAttribute('data-miss', '')
  window.setTimeout(() => el.gridWrap.removeAttribute('data-miss'), 320)
}

function submit(path) {
  const text = readPath(state.puzzle.grid, path)
  const match = level().words.find(
    (word) => !state.found.has(word) && (word === text || word === reverse(text))
  )
  if (!match) return foundSecret(text, path)

  play('found')
  sparkle(match, path)
  state.found.set(match, path)
  const item = el.words.querySelector(`[data-word="${match}"]`)
  if (item) item.dataset.found = ''
  el.tally.textContent = `${state.found.size} з ${level().words.length}`
  el.announce.textContent = `Знайдено: ${label(match)}`

  if (state.found.size === level().words.length) {
    play('level')
    window.setTimeout(finishLevel, 850)
  }
  return true
}

// Слова, якого немає в списку, ніхто не шукає — тому за нього окрема реакція.
function foundSecret(text, path) {
  const secret = level().secret
  if (state.secret || !secret) return false
  if (text !== secret && reverse(text) !== secret) return false

  state.secret = path
  play('secret')
  sparkle(secret, path)
  el.announce.textContent = `Знайдено сховане слово: ${secret}`
  window.setTimeout(() => openCard(SECRET_CARD), 450)
  return true
}

/* ---------- переходи ---------- */

const ROLL_BAND_MS = 340
const ROLL_STAGGER = 100
const ROLL_FADE_MS = 260
const CRUMPLE_STEPS = 4
const CRUMPLE_STEP_MS = 170

// Валик кладе горизонтальні смуги — то в один бік, то в інший. Висоту
// кожної кидаємо наново, а наступна лягає з нахлистом на попередню, щоб
// екран усе одно був накритий повністю.
function paintBands() {
  const bands = []
  let edge = -5

  while (edge < 100) {
    const height = 11 + Math.random() * 25
    const band = document.createElement('i')
    band.style.top = `${edge}%`
    band.style.height = `${height + 7}%`
    band.style.setProperty('--band', `hsl(340 60% ${88 + Math.random() * 6}%)`)
    band.style.animationDelay = `${bands.length * ROLL_STAGGER + Math.random() * 70}ms`
    band.style.animationDuration = `${ROLL_BAND_MS + Math.random() * 140}ms`
    if (bands.length % 2) band.dataset.back = ''
    bands.push(band)
    edge += height
  }

  return bands
}

function rollOver(swap) {
  const bands = paintBands()
  const cover = (bands.length - 1) * ROLL_STAGGER + ROLL_BAND_MS + 210
  el.roller.replaceChildren(...bands)
  el.roller.removeAttribute('data-done')
  el.roller.setAttribute('data-active', '')
  paintRoll()

  window.setTimeout(swap, cover)
  window.setTimeout(() => el.roller.setAttribute('data-done', ''), cover + 60)
  window.setTimeout(() => el.roller.removeAttribute('data-active'), cover + 60 + ROLL_FADE_MS)
}

// Аркуш жмакається не плавно, а ривками — на кожен крок свій злам і свій хрускіт.
function crumpleSheet(done) {
  let step = 0
  const fold = () => {
    step += 1
    el.sheet.dataset.crumple = String(step)
    crumple(step)
    if (step < CRUMPLE_STEPS) {
      window.setTimeout(fold, CRUMPLE_STEP_MS)
      return
    }
    window.setTimeout(done, CRUMPLE_STEP_MS + 120)
  }
  fold()
}

function flattenSheet() {
  el.sheet.removeAttribute('data-crumple')
}

/* ---------- час ---------- */

const LOW_TIME_MS = 10_000

function clockText(ms) {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function startTimer(seconds) {
  stopTimer()
  state.remaining = seconds * 1000
  state.deadline = Date.now() + state.remaining
  // Смужка тане силами CSS, а от рішення «час вийшов» ухвалює годинник:
  // у фоновій вкладці таймери притишуються, а Date.now() — ні.
  el.drain.style.animation = 'none'
  void el.drain.offsetWidth
  el.drain.style.animation = `drain ${seconds}s linear forwards`
  el.drain.style.animationPlayState = 'running'
  tick()
  state.ticker = window.setInterval(tick, 250)
}

function tick() {
  const left = Math.max(0, state.deadline - Date.now())
  el.clock.textContent = clockText(left)
  el.clockLine.toggleAttribute('data-low', left > 0 && left <= LOW_TIME_MS)
  if (!left) timeUp()
}

function stopTimer() {
  window.clearInterval(state.ticker)
  state.ticker = 0
}

function pauseTimer() {
  if (!state.ticker) return
  state.remaining = Math.max(0, state.deadline - Date.now())
  stopTimer()
  el.drain.style.animationPlayState = 'paused'
}

function resumeTimer() {
  if (state.ticker || !state.remaining || document.hidden) return
  state.deadline = Date.now() + state.remaining
  el.drain.style.animationPlayState = 'running'
  state.ticker = window.setInterval(tick, 250)
}

function timeUp() {
  stopTimer()
  state.remaining = 0
  el.clockLine.removeAttribute('data-low')
  crumpleSheet(() => {
    play('timeout')
    openCard(TIME_UP_CARD)
  })
}

/* ---------- картки-репліки ---------- */

// Підказка не підказує, поки її не випросиш тричі.
const HINT_CARDS = [
  {
    title: 'ти у мене дуже <span class="marked">розумна</span>',
    text: 'тому тобі підказки не потрібні',
    button: 'ну добре',
  },
  {
    title: 'ну <span class="marked">подивись</span> ще раз',
    text: 'воно прямо перед тобою, чесно',
    button: 'дивлюсь',
  },
  {
    title: '<span class="marked">здаюсь</span>',
    text: 'ось перша літера — далі сама',
    button: 'дякую',
    after: revealFirstLetter,
  },
]

const TIME_UP_CARD = {
  title: '<span class="marked">час вийшов</span>',
  text: 'сітка буде нова — спробуй ще раз',
  button: 'ще раз',
  after: () => startLevel(state.levelIndex),
}

const SECRET_CARD = {
  title: '<span class="marked">хехе</span>',
  text: 'цього слова навіть у списку не було',
  button: 'хехе',
}

function openCard(card) {
  pauseTimer()
  splash()
  el.cardTitle.innerHTML = card.title
  el.cardText.textContent = card.text
  el.cardClose.textContent = card.button
  state.afterCard = card.after ?? null
  el.card.setAttribute('data-active', '')
}

function closeCard() {
  if (!el.card.hasAttribute('data-active')) return
  el.card.removeAttribute('data-active')
  const after = state.afterCard
  state.afterCard = null
  resumeTimer()
  if (after) after()
}

function askHint() {
  const card = HINT_CARDS[Math.min(state.hintPresses, HINT_CARDS.length - 1)]
  state.hintPresses += 1
  openCard(card)
}

function revealFirstLetter() {
  const hidden = state.puzzle.placements.filter(
    (spot) => !spot.secret && !state.found.has(spot.word)
  )
  if (!hidden.length) return

  clearHint()
  const spot = hidden[Math.floor(Math.random() * hidden.length)]
  const first = spot.cells[0]
  const cell = state.cells[first.r][first.c]
  cell.style.setProperty('--hint', COLOR.get(spot.word))
  cell.dataset.hint = ''
  state.hint = cell
  state.hintTimer = window.setTimeout(clearHint, 2200)
}

function clearHint() {
  window.clearTimeout(state.hintTimer)
  if (!state.hint) return
  state.hint.removeAttribute('data-hint')
  state.hint = null
}

/* ---------- перебіг рівнів ---------- */

function startLevel(index) {
  flattenSheet()
  state.levelIndex = index
  state.puzzle = buildPuzzle(level())
  state.found = new Map()
  state.drawn = new Set()
  state.selection = null
  state.anchor = null
  state.dragging = false
  state.secret = null
  state.hintPresses = 0
  clearHint()

  primeSounds()
  startTimer(levelSeconds(level()))
  el.note.textContent = level().note
  renderPips()
  renderWords()
  renderGrid()
  el.marks.replaceChildren()
  for (const spark of el.gridWrap.querySelectorAll('.spark')) spark.remove()
  showScreen('game')
  // Міряємо одразу після показу екрана: requestAnimationFrame у фоновій
  // вкладці не спрацьовує, і сітка лишалась би з типовим розміром літер.
  syncCellSize()
  drawMarks()
}

function finishLevel() {
  stopTimer()
  rememberPassed(Math.max(passedLevels(), state.levelIndex + 1))
  const isLast = state.levelIndex === LEVELS.length - 1
  if (isLast) {
    showFinale()
    return
  }
  el.curtainTitle.textContent = `рівень ${level().id} зібрано`
  el.curtainNote.textContent = `далі — ${LEVELS[state.levelIndex + 1].note}`
  el.curtain.setAttribute('data-active', '')
}

function showFinale() {
  el.collected.replaceChildren(
    ...ALL_WORDS.map((word) => {
      const item = document.createElement('li')
      item.textContent = label(word)
      item.style.background = COLOR.get(word)
      item.style.borderColor = 'transparent'
      return item
    })
  )
  renderPips(LEVELS.length, -1)
  showScreen('finale')
}

/* ---------- запуск ---------- */

el.grid.addEventListener('pointerdown', startSelection)
el.grid.addEventListener('pointermove', extendSelection)
el.grid.addEventListener('pointerup', endSelection)
el.grid.addEventListener('pointercancel', () => {
  state.dragging = false
  state.selection = null
  paintStop()
  drawMarks()
})

// Перемкнулась на інший застосунок — час зачекає.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseTimer()
  else if (!el.card.hasAttribute('data-active')) resumeTimer()
})

el.hint.addEventListener('click', askHint)
el.cardClose.addEventListener('click', closeCard)
el.card.addEventListener('click', (event) => {
  if (event.target === el.card) closeCard()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeCard()
})

el.next.addEventListener('click', () => {
  el.curtain.removeAttribute('data-active')
  startLevel(state.levelIndex + 1)
})

document.getElementById('start').addEventListener('click', () => {
  const passed = passedLevels()
  primeSounds()
  rollOver(() => startLevel(passed >= LEVELS.length ? 0 : passed))
})

document.getElementById('again').addEventListener('click', () => {
  rememberPassed(0)
  rollOver(() => startLevel(0))
})

// Сітка змінює розмір не лише від вікна — ще й коли дозавантажився шрифт
// або телефон перевернули, тож слухаємо саму сітку.
new ResizeObserver(() => {
  if (!state.puzzle) return
  syncCellSize()
  drawMarks()
}).observe(el.grid)

const passed = passedLevels()
renderPips(passed, passed < LEVELS.length ? passed : -1)
if (passed > 0 && passed < LEVELS.length) {
  document.getElementById('start').textContent = `далі — рівень ${passed + 1}`
}
