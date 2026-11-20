/**
 * 한글·워드 문서의 글꼴을 무료 글꼴(Noto Serif KR·Noto Sans KR, OFL)로 바꿔 그려요.
 * 어느 휴대폰에서 바꿔도 결과가 똑같이 나오게 하려는 거예요.
 *
 * 처음에는 한컴·MS 글꼴 이름마다 FontFace 를 등록했는데, 크롬(안드로이드)은 이름마다 글꼴 파일을
 * 따로 받아 따로 풀어 두어서 메모리를 1GB 넘게 썼어요. 그래서
 *   - 글꼴은 4개(명조·고딕 × 보통·굵게)만 우리만 쓰는 이름으로 등록하고
 *   - 문서가 요청하는 글꼴 이름(함초롬바탕, 맑은 고딕 …)을 그 이름으로 바꿔 끼워요
 *     (한글: 캔버스 font 문자열, 워드: HTML 의 font-family)
 * - 대체 글꼴에 없는 글자(한자, ※ ○ □ ① 같은 기호)는 원래 이름 목록을 뒤에 남겨 두어 기기 글꼴로 그려요.
 * - 글꼴 파일은 public/fonts/ 에 있어요 (서비스 워커가 저장해 둬서 두 번째부터는 바로 써요).
 *   한 번 받은 내용을 기억해 두었다가 다른 문서(iframe 등)에도 그대로 등록해요
 * - 다 받을 때까지 기다린 다음 그려야 해요 (안 기다리면 기기마다 글꼴·줄바꿈이 달라져요)
 */

/** 우리만 쓰는 글꼴 이름 (앱 화면 글꼴과 섞이지 않게) */
export const SERIF_FAMILY = 'AM Convert Serif'
export const SANS_FAMILY = 'AM Convert Sans'

const FACES = [
  { family: SERIF_FAMILY, file: 'NotoSerifKR-Regular.woff2', weight: '400' },
  { family: SERIF_FAMILY, file: 'NotoSerifKR-Bold.woff2', weight: '700' },
  { family: SANS_FAMILY, file: 'NotoSansKR-Regular.woff2', weight: '400' },
  { family: SANS_FAMILY, file: 'NotoSansKR-Bold.woff2', weight: '700' },
] as const

/** 명조(바탕) 계열 → 명조 대체 글꼴 */
const SERIF = [
  'Noto Serif KR',
  'Noto Serif CJK KR',
  '함초롬바탕',
  'HCR Batang',
  '한컴바탕',
  '한컴 바탕',
  'Haansoft Batang',
  '바탕',
  '바탕체',
  'Batang',
  'BatangChe',
  '새바탕',
  '궁서',
  '궁서체',
  'Gungsuh',
  'GungsuhChe',
  '신명조',
  '명조',
  '휴먼명조',
  '한양신명조',
  'HY신명조',
  'HYSinMyeongJo-Medium',
  '나눔명조',
  'NanumMyeongjo',
  'Nanum Myeongjo',
  'KoPub바탕체',
  'KoPubBatang',
  'AppleMyungjo',
  // 워드 영문 명조 (영문도 대체 글꼴로 그려야 휴대폰마다 줄바꿈이 같아요)
  'Times New Roman',
  'Times',
  'Cambria',
  'Georgia',
  'Garamond',
  'Book Antiqua',
  'Palatino Linotype',
]
/** 굵은 제목용 명조 → 보통 굵기도 Bold 로 */
const SERIF_HEAVY = ['HY견명조', '한양견명조', '견명조']

/** 고딕(돋움) 계열 → 고딕 대체 글꼴 */
const SANS = [
  'Noto Sans KR',
  'Noto Sans CJK KR',
  '함초롬돋움',
  'HCR Dotum',
  '한컴돋움',
  '한컴 돋움',
  'Haansoft Dotum',
  '한컴 고딕',
  '한컴산뜻돋움',
  '돋움',
  '돋움체',
  'Dotum',
  'DotumChe',
  '굴림',
  '굴림체',
  'Gulim',
  'GulimChe',
  '새굴림',
  'New Gulim',
  '맑은 고딕',
  'Malgun Gothic',
  '고딕',
  '휴먼고딕',
  'HY중고딕',
  '한양중고딕',
  'HYGothic-Medium',
  'HY그래픽',
  '나눔고딕',
  'NanumGothic',
  'Nanum Gothic',
  '나눔바른고딕',
  'NanumBarunGothic',
  'KoPub돋움체',
  'KoPubDotum',
  'AppleGothic',
  'Apple SD Gothic Neo',
  // 워드 영문 고딕 (Aptos 는 워드 2023년 이후 기본 글꼴, Calibri 는 그 전 기본 글꼴)
  'Aptos',
  'Aptos Display',
  'Aptos Narrow',
  'Calibri',
  'Calibri Light',
  'Arial',
  'Helvetica',
  'Helvetica Neue',
  'Segoe UI',
  'Verdana',
  'Tahoma',
]
/** 굵은 제목용 고딕 → 보통 굵기도 Bold 로 */
const SANS_HEAVY = ['HY헤드라인M', 'HYHeadLine M', 'HYHeadLine-Medium', 'HY견고딕', '한양견고딕', 'HYGothic-Extra', '헤드라인', '휴먼둥근헤드라인']

/** 영문 명조 계열 (한글 글꼴 이름이 없을 때 명조/고딕을 고르는 데만 써요) */
const LATIN_SERIF = ['serif', 'times new roman', 'times', 'cambria', 'georgia', 'garamond', 'book antiqua', 'palatino linotype', 'palatino']

const lower = (a: string[]) => new Set(a.map((n) => n.toLowerCase()))
const SERIF_SET = lower(SERIF)
const SERIF_HEAVY_SET = lower(SERIF_HEAVY)
const SANS_SET = lower(SANS)
const SANS_HEAVY_SET = lower(SANS_HEAVY)
const LATIN_SERIF_SET = new Set(LATIN_SERIF)
/** 위 목록 가운데 영문 글꼴 (한글 글꼴 이름이 함께 있으면 그쪽을 따라요) */
const LATIN_KNOWN_SET = lower([
  'Times New Roman', 'Times', 'Cambria', 'Georgia', 'Garamond', 'Book Antiqua', 'Palatino Linotype',
  'Aptos', 'Aptos Display', 'Aptos Narrow', 'Calibri', 'Calibri Light', 'Arial', 'Helvetica', 'Helvetica Neue', 'Segoe UI', 'Verdana', 'Tahoma',
])

type Pick = { family: string; heavy: boolean; known: boolean }

/** 글꼴 이름 목록에서 대체 글꼴을 골라요. 앞쪽에 있는 한글 글꼴 이름을 따라요 */
function pick(list: string): Pick {
  const names = list
    .split(',')
    .map((n) => n.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean)
  // 한글 글꼴 이름을 먼저 봐요 ('Calibri, 바탕' 이면 한글이 바탕으로 그려지니 명조)
  for (const latinToo of [false, true]) {
    for (const n of names) {
      if (!latinToo && LATIN_KNOWN_SET.has(n)) continue
      if (SERIF_HEAVY_SET.has(n)) return { family: SERIF_FAMILY, heavy: true, known: true }
      if (SERIF_SET.has(n)) return { family: SERIF_FAMILY, heavy: false, known: true }
      if (SANS_HEAVY_SET.has(n)) return { family: SANS_FAMILY, heavy: true, known: true }
      if (SANS_SET.has(n)) return { family: SANS_FAMILY, heavy: false, known: true }
    }
  }
  const serifish = names.some((n) => LATIN_SERIF_SET.has(n))
  return { family: serifish ? SERIF_FAMILY : SANS_FAMILY, heavy: false, known: false }
}

/**
 * font-family 목록을 바꿔요.
 *  - 아는 한글 글꼴(함초롬바탕·맑은 고딕 …)이 있으면: 대체 글꼴을 맨 앞에 (영문까지 대체 글꼴로 그려 어디서나 같게)
 *  - 모르는 글꼴(한컴 윤고딕 …)뿐이면: 맨 뒤에 붙여서 그 글꼴이 없거나 한글이 없을 때만 쓰게
 */
export function mapFamilyList(list: string): string {
  const t = list.trim()
  if (!t || t.includes(SERIF_FAMILY) || t.includes(SANS_FAMILY)) return t
  const p = pick(t)
  return p.known ? `"${p.family}", ${t}` : `${t}, "${p.family}"`
}

/** 대체 글꼴 종류: 명조면 'serif', 고딕이면 'sans', 모르는 글꼴(기기 글꼴로 그려짐)이면 null */
export function replacementKind(list: string): 'serif' | 'sans' | null {
  const p = pick(list)
  if (!p.known) return null
  return p.family === SERIF_FAMILY ? 'serif' : 'sans'
}

/** 굵은 제목용 글꼴(HY헤드라인M 등)이면 true */
export function isHeavyFamily(list: string): boolean {
  return pick(list).heavy
}

const fontCache = new Map<string, string>()
// 'bold 13.33px 함초롬바탕, serif' 처럼: [앞부분(굵기 등)] [크기[/줄높이]] [글꼴 목록]
const SHORTHAND = /^(.*?)(\d*\.?\d+(?:px|pt|em|rem|%))(\s*\/\s*\S+)?\s+(.+)$/

/** 캔버스 font 문자열(CSS font 줄임말)의 글꼴 이름을 바꿔요 */
export function mapCanvasFont(font: string): string {
  let out = fontCache.get(font)
  if (out !== undefined) return out
  const m = SHORTHAND.exec(font.trim())
  if (!m) out = font
  else {
    const [, pre, size, lh = '', fams] = m
    let prefix = pre
    if (pick(fams).heavy && !/\b(bold|bolder|[6-9]00)\b/.test(prefix)) prefix = `700 ${prefix}`
    out = `${prefix}${size}${lh} ${mapFamilyList(fams)}`
  }
  if (fontCache.size > 2000) fontCache.clear()
  fontCache.set(font, out)
  return out
}

const fontDesc = typeof CanvasRenderingContext2D === 'function' ? Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font') : undefined

/**
 * fn 을 도는 동안만 캔버스에 넣는 font 문자열의 글꼴 이름을 바꿔요 (한글 엔진이 캔버스에 직접 글꼴을 넣어서).
 * fn 은 동기 함수여야 해요 — 그동안 다른 코드가 끼어들지 않아 앱의 다른 캔버스에는 영향이 없어요.
 */
export function withMappedCanvasFonts<T>(fn: () => T): T {
  const d = fontDesc
  if (!d || !d.get || !d.set) return fn()
  const set = d.set
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(this: CanvasRenderingContext2D, v: string) {
      set.call(this, mapCanvasFont(String(v)))
    },
  })
  try {
    return fn()
  } finally {
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', d)
  }
}

function fontUrl(file: string): string {
  return new URL(`${import.meta.env.BASE_URL}fonts/${file}`, document.baseURI).href
}

type FontWindow = Window & { FontFace: typeof FontFace }

/**
 * 글꼴 파일 4개의 내용. 처음 한 번만 앱 화면(서비스 워커를 거쳐요)에서 받아 두고,
 * 화면 밖 iframe·html2canvas 복제본처럼 새 문서에 등록할 때는 이 내용을 그대로 써요.
 * (새 문서에서 url 로 등록하면 크롬은 서비스 워커를 거치지 않고 매번 다시 받아서, 인터넷이 끊기면 실패해요)
 */
let fileBytes: Promise<ArrayBuffer[]> | null = null

function fontFiles(): Promise<ArrayBuffer[]> {
  if (!fileBytes) {
    fileBytes = Promise.all(
      FACES.map(async ({ file }) => {
        const res = await fetch(fontUrl(file))
        if (!res.ok) throw new Error(`font ${res.status}`)
        return res.arrayBuffer()
      }),
    )
    // 못 받았으면 다음에 다시 받아 볼 수 있게
    fileBytes.catch(() => {
      fileBytes = null
    })
  }
  return fileBytes
}

const loaded = new WeakMap<Document, Promise<boolean>>()

/**
 * doc(기본: 지금 화면)에 대체 글꼴 4개를 등록하고 쓸 수 있을 때까지 기다려요. 한 문서에 한 번만 해요.
 * 글꼴을 못 받으면(인터넷이 끊김 등) false — 그래도 변환은 기기 글꼴로 계속해요.
 */
export function ensureFonts(doc: Document = document): Promise<boolean> {
  let p = loaded.get(doc)
  if (!p) {
    p = register(doc).then(
      (ok) => {
        if (!ok) loaded.delete(doc) // 다음에 다시 받아 볼 수 있게
        return ok
      },
      () => {
        loaded.delete(doc)
        return false
      },
    )
    loaded.set(doc, p)
  }
  return p
}

async function register(doc: Document): Promise<boolean> {
  const win = doc.defaultView as FontWindow | null
  if (!win || typeof win.FontFace !== 'function' || !doc.fonts) return false
  let files: ArrayBuffer[]
  try {
    files = await fontFiles()
  } catch {
    return false
  }
  // FontFace 는 받은 내용을 복사해서 써요. 그래서 같은 내용을 여러 문서에 등록해도 괜찮아요
  const faces = FACES.map(({ family, weight }, i) => new win.FontFace(family, files[i], { weight, style: 'normal', display: 'block' }))
  const results = await Promise.allSettled(faces.map((f) => f.load()))
  // 일부만 쓸 수 있으면 기기마다 결과가 달라지니, 다 됐을 때만 등록해요
  if (results.some((r) => r.status === 'rejected')) return false
  for (const f of faces) doc.fonts.add(f)
  return true
}
