// Генерація сітки: розкладає слова рівня по клітинках і засипає решту літерами.

export const DIRECTIONS = {
  E: [0, 1],
  S: [1, 0],
  SE: [1, 1],
  NE: [-1, 1],
  W: [0, -1],
  N: [-1, 0],
  SW: [1, -1],
  NW: [-1, -1],
}

// Слова не повторюються між рівнями: далі — довші слова й більша сітка.
// Задом наперед слова не лежать ніде — тільки зліва направо, згори вниз і по діагоналі вниз/вгору.
export const LEVELS = [
  {
    id: 1,
    size: 9,
    words: ['булка', 'ксюня'],
    dirs: ['E', 'S'],
    note: 'слова лежать зліва направо або згори вниз',
  },
  {
    id: 2,
    size: 11,
    words: ['скучаю', 'васька', 'лублу'],
    dirs: ['E', 'S'],
    note: 'напрямки ті самі, слів більше',
  },
  {
    id: 3,
    size: 13,
    words: ['дєлаєм', 'полежати', 'наждачка'],
    dirs: ['E', 'S', 'SE', 'NE'],
    note: 'додались діагоналі',
  },
  {
    id: 4,
    size: 14,
    words: ['услишала', 'буквально', 'харошенький', 'лобнадоля'],
    // Секретне слово лежить у сітці, але не в списку — його треба намацати самій.
    secret: 'хехе',
    dirs: ['E', 'S', 'SE', 'NE'],
    note: 'найдовші слова і найбільша сітка',
  },
]

// У сітці слово лежить без пробілу, а в списку показуємо його як фразу.
export const LABELS = { лобнадоля: 'лобна доля' }

export function label(word) {
  return LABELS[word] ?? word
}

// На кожне слово — від 20 до 25 секунд, залежно від довжини.
// Секретне слово часу не додає: його ніхто не зобов'язаний шукати.
export function levelSeconds(level) {
  return level.words.reduce((total, word) => total + Math.min(25, 20 + Math.max(0, word.length - 5)), 0)
}

const ALPHABET = [...'абвгдеєжзиійклмнопрстуфхцчшщьюя']

const PLACEMENT_ATTEMPTS = 400
const GRID_ATTEMPTS = 80

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function placeWord(grid, word, dirs, size) {
  const letters = [...word]
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const [dr, dc] = DIRECTIONS[pick(dirs)]
    const row = Math.floor(Math.random() * size)
    const col = Math.floor(Math.random() * size)
    const cells = []
    let fits = true

    for (let i = 0; i < letters.length; i++) {
      const r = row + dr * i
      const c = col + dc * i
      if (r < 0 || c < 0 || r >= size || c >= size) {
        fits = false
        break
      }
      const taken = grid[r][c]
      if (taken && taken !== letters[i]) {
        fits = false
        break
      }
      cells.push({ r, c })
    }

    if (!fits) continue
    cells.forEach(({ r, c }, i) => {
      grid[r][c] = letters[i]
    })
    return cells
  }
  return null
}

// Літери-наповнювачі беруться переважно з самих слів — так слова не впадають в око.
function fillerPool(words) {
  const own = [...words.join('')]
  return [...own, ...own, ...own, ...ALPHABET]
}

function fillBlanks(grid, words) {
  const pool = fillerPool(words)
  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) row[c] = pick(pool)
    }
  }
}

export function buildPuzzle(level) {
  const all = level.secret ? [...level.words, level.secret] : [...level.words]
  const byLengthDesc = [...all].sort((a, b) => b.length - a.length)

  for (let round = 0; round < GRID_ATTEMPTS; round++) {
    const grid = Array.from({ length: level.size }, () => Array(level.size).fill(''))
    const placements = []
    let placedAll = true

    for (const word of byLengthDesc) {
      const cells = placeWord(grid, word, level.dirs, level.size)
      if (!cells) {
        placedAll = false
        break
      }
      placements.push({ word, cells, secret: word === level.secret })
    }

    if (!placedAll) continue
    fillBlanks(grid, all)
    return { size: level.size, grid, placements }
  }

  throw new Error(`Не вдалось розкласти слова рівня ${level.id}`)
}

export function readPath(grid, cells) {
  return cells.map(({ r, c }) => grid[r][c]).join('')
}

export function reverse(text) {
  return [...text].reverse().join('')
}
