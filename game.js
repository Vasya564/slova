import { LEVELS, buildPuzzle, label, readPath, reverse } from './puzzle.js'
import { play, soundEnabled, toggleSound } from './sound.js'

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
  grid: document.getElementById('grid'),
  gridWrap: document.querySelector('.grid-wrap'),
  marks: document.getElementById('marks'),
  words: document.getElementById('words'),
  tally: document.getElementById('tally'),
  note: document.getElementById('note'),
  hint: document.getElementById('hint'),
  sound: document.getElementById('sound'),
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

function stroke(cells, color, width, opacity) {
  const a = centerOf(cells[0])
  const b = centerOf(cells[cells.length - 1])
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', a.x)
  line.setAttribute('y1', a.y)
  line.setAttribute('x2', b.x)
  line.setAttribute('y2', b.y)
  line.setAttribute('stroke', color)
  line.setAttribute('stroke-width', width)
  line.setAttribute('opacity', opacity)
  return { line, length: Math.hypot(b.x - a.x, b.y - a.y) }
}

function drawMarks() {
  const width = el.grid.clientWidth / state.puzzle.size
  const marks = []

  for (const [word, cells] of state.found) {
    const { line, length } = stroke(cells, COLOR.get(word), width * 0.78, 0.95)
    // штрих «замальовується» від першої літери до останньої
    if (!state.drawn.has(word)) {
      state.drawn.add(word)
      line.style.strokeDasharray = `${length}`
      line.style.strokeDashoffset = `${length}`
      requestAnimationFrame(() => {
        line.style.transition = 'stroke-dashoffset 0.5s cubic-bezier(0.2, 0.7, 0.3, 1)'
        line.style.strokeDashoffset = '0'
      })
    }
    marks.push(line)
  }

  if (state.secret) {
    marks.push(stroke(state.secret, SECRET_COLOR, width * 0.78, 0.95).line)
  }

  if (state.selection) {
    marks.push(stroke(state.selection, 'rgba(122, 116, 158, 0.28)', width * 0.72, 1).line)
  }

  el.marks.replaceChildren(...marks)
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
  drawMarks()
}

function extendSelection(event) {
  if (!state.dragging || !state.selection) return
  const cell = cellAt(event.clientX, event.clientY)
  if (!cell) return
  const path = pathBetween(state.selection[0], cell)
  if (!path) return
  state.selection = path
  drawMarks()
}

function endSelection(event) {
  if (!state.dragging || !state.selection) return
  state.dragging = false
  release(event.pointerId)

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
  el.announce.textContent = `Знайдено сховане слово: ${secret}`
  window.setTimeout(() => openCard(SECRET_CARD), 450)
  return true
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

const SECRET_CARD = {
  title: '<span class="marked">хехе</span>',
  text: 'цього слова навіть у списку не було',
  button: 'хехе',
}

function openCard(card) {
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

  el.note.textContent = level().note
  renderPips()
  renderWords()
  renderGrid()
  el.marks.replaceChildren()
  showScreen('game')
  requestAnimationFrame(() => {
    syncCellSize()
    drawMarks()
  })
}

function finishLevel() {
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
  drawMarks()
})

el.hint.addEventListener('click', askHint)
el.cardClose.addEventListener('click', closeCard)
el.card.addEventListener('click', (event) => {
  if (event.target === el.card) closeCard()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeCard()
})

el.sound.addEventListener('click', () => renderSound(toggleSound()))

function renderSound(on) {
  el.sound.toggleAttribute('data-off', !on)
  el.sound.setAttribute('aria-pressed', String(on))
}

el.next.addEventListener('click', () => {
  el.curtain.removeAttribute('data-active')
  startLevel(state.levelIndex + 1)
})

document.getElementById('start').addEventListener('click', () => {
  const passed = passedLevels()
  startLevel(passed >= LEVELS.length ? 0 : passed)
})

document.getElementById('again').addEventListener('click', () => {
  rememberPassed(0)
  startLevel(0)
})

window.addEventListener('resize', () => {
  if (!state.puzzle) return
  syncCellSize()
  drawMarks()
})

renderSound(soundEnabled())

const passed = passedLevels()
renderPips(passed, passed < LEVELS.length ? passed : -1)
if (passed > 0 && passed < LEVELS.length) {
  document.getElementById('start').textContent = `далі — рівень ${passed + 1}`
}
