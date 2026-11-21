/**
 * 파일 종류 알아보기: 확장자와 파일 앞부분(매직 바이트)을 같이 봐요.
 * (iOS 는 accept=".hwp" 로 제한하면 한글 파일을 고를 수 없게 막아 버려서, 아무 파일이나 받고 여기서 가려요)
 */
import { MAX_INPUT_BYTES, type SourceKind } from './types'

export type SniffedKind = SourceKind | 'doc' | null
/** 암호가 걸린 워드 파일(.docx)은 겉이 예전 워드처럼 OLE 상자라서 따로 표시해요 */
export type Sniffed = { kind: SniffedKind; encryptedOoxml?: boolean }

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'])

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

function byExt(ext: string): SniffedKind {
  if (ext === 'hwp' || ext === 'hwpx' || ext === 'docx' || ext === 'pdf') return ext
  if (ext === 'doc') return 'doc'
  if (IMAGE_EXT.has(ext)) return 'image'
  return null
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const utf16 = (s: string) => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) out[i * 2] = s.charCodeAt(i)
  return out
}

/** 바이트 배열 안에서 pat 를 찾아요 (첫 글자로 건너뛰며 찾아서 30MB 도 금방 끝나요) */
export function hasBytes(hay: Uint8Array, pat: Uint8Array, from = 0, to = hay.length): boolean {
  const first = pat[0]
  const last = Math.min(to, hay.length) - pat.length
  let i = hay.indexOf(first, from)
  while (i !== -1 && i <= last) {
    let j = 1
    while (j < pat.length && hay[i + j] === pat[j]) j++
    if (j === pat.length) return true
    i = hay.indexOf(first, i + 1)
  }
  return false
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']

function imageMagic(b: Uint8Array): boolean {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return true // JPEG
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true // PNG
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return true // GIF
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return true // WebP
  if (startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (HEIF_BRANDS.includes(brand)) return true // HEIC·AVIF (브라우저가 열 수 있을 때만 바뀌어요)
  }
  return false
}

/**
 * 파일을 살펴봐요. all 을 주면(이미 다 읽은 바이트) 그걸로, 없으면 필요한 부분만 읽어요.
 */
export async function sniff(file: Blob & { name: string }, all?: Uint8Array): Promise<Sniffed> {
  const ext = extOf(file.name)
  const read = async (start: number, end: number) =>
    all ? all.subarray(start, end) : new Uint8Array(await file.slice(start, end).arrayBuffer())

  let head: Uint8Array
  try {
    head = await read(0, 4096)
  } catch {
    return { kind: byExt(ext) }
  }
  if (head.length === 0) return { kind: null }

  // PDF: 앞 1KB 안에 %PDF 가 있어요
  if (hasBytes(head, ascii('%PDF-'), 0, 1024)) return { kind: 'pdf' }
  if (imageMagic(head)) return { kind: 'image' }
  if (ext === 'bmp' && startsWith(head, [0x42, 0x4d])) return { kind: 'image' }

  // 예전 한글(3.x)
  if (hasBytes(head, ascii('HWP Document File'), 0, 64)) return { kind: 'hwp' }

  // OLE 상자: 한글 5.x(.hwp), 예전 워드(.doc), 엑셀·파워포인트, 암호 걸린 docx
  if (startsWith(head, OLE)) {
    let body: Uint8Array
    try {
      body = all ?? (file.size <= MAX_INPUT_BYTES ? new Uint8Array(await file.arrayBuffer()) : head)
    } catch {
      return { kind: byExt(ext) }
    }
    if (hasBytes(body, utf16('FileHeader')) && (hasBytes(body, utf16('BodyText')) || hasBytes(body, utf16('DocInfo')))) return { kind: 'hwp' }
    if (hasBytes(body, utf16('EncryptedPackage'))) return ext === 'docx' ? { kind: 'docx', encryptedOoxml: true } : { kind: null }
    if (hasBytes(body, utf16('WordDocument'))) return { kind: 'doc' }
    if (hasBytes(body, utf16('Workbook')) || hasBytes(body, utf16('PowerPoint Document'))) return { kind: null }
    return { kind: ext === 'hwp' || ext === 'doc' ? byExt(ext) : null }
  }

  // ZIP 상자: hwpx 또는 docx (파일 이름 목록은 맨 뒤 '중앙 디렉터리'에 있어요)
  if (startsWith(head, ZIP)) {
    let tail: Uint8Array
    try {
      const size = all ? all.length : file.size
      tail = await read(Math.max(0, size - 512 * 1024), size)
    } catch {
      return { kind: byExt(ext) }
    }
    const has = (s: string) => hasBytes(head, ascii(s)) || hasBytes(tail, ascii(s))
    if (has('application/hwp+zip') || has('Contents/section') || has('Contents/content.hpf')) return { kind: 'hwpx' }
    if (has('word/document')) return { kind: 'docx' }
    if (has('xl/workbook') || has('ppt/presentation')) return { kind: null }
    return { kind: ext === 'hwpx' || ext === 'docx' ? ext : null }
  }

  // RTF 를 .doc 로 저장한 경우도 예전 워드처럼 안내해요
  if (hasBytes(head, ascii('{\\rtf'), 0, 8)) return { kind: ext === 'doc' || ext === 'rtf' ? 'doc' : null }

  // 앞부분으로 알 수 없으면 확장자를 믿고 (변환할 때 못 읽으면 '파일을 읽지 못했어요'로 안내해요)
  return { kind: byExt(ext) }
}

/**
 * 한글 5.x 파일 머리(FileHeader)의 속성 값으로 암호 문서인지 봐요.
 * 'HWP Document File' 서명 뒤 32바이트 자리에 판(4바이트), 그 뒤 속성(4바이트): 둘째 비트 = 암호
 */
export function hwpPasswordProtected(bytes: Uint8Array): boolean {
  // 한글 5.x(OLE 상자)에만 있는 머리예요. 예전 한글(3.x)은 머리 모양이 달라서 보지 않아요
  if (!startsWith(bytes, OLE)) return false
  const sig = ascii('HWP Document File')
  let i = bytes.indexOf(sig[0])
  while (i !== -1 && i + 40 <= bytes.length) {
    let j = 1
    while (j < sig.length && bytes[i + j] === sig[j]) j++
    if (j === sig.length) {
      const props = bytes[i + 36] | (bytes[i + 37] << 8)
      return (props & 0b10) !== 0
    }
    i = bytes.indexOf(sig[0], i + 1)
  }
  return false
}

/** 압축을 푼 크기 한도 (워드·한글 파일). 정상 보고서는 몇십 MB 를 넘지 않아요 */
export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024
/** 파일 하나(본문 XML 등)를 푼 크기 한도 */
export const MAX_UNZIPPED_ENTRY_BYTES = 120 * 1024 * 1024
const MAX_ZIP_ENTRIES = 20_000

/**
 * ZIP 상자(docx·hwpx)를 풀면 너무 커지는지 봐요 (작은 파일이 풀면 몇 GB 가 되는 '압축 폭탄' 막기).
 * 맨 뒤 '중앙 디렉터리'에 적힌 크기를 더해요. 읽을 수 없으면 false (나중에 열 때 '손상된 파일'로 안내돼요)
 */
export function zipTooLarge(bytes: Uint8Array): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = bytes.length
  // 끝에서 '중앙 디렉터리 끝' 표시(PK\5\6)를 찾아요 (뒤에 주석이 최대 64KB 붙을 수 있어요)
  let eocd = -1
  for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return false
  const entries = dv.getUint16(eocd + 10, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  // ZIP64(4GB 넘는 상자) 표시면 보고서 파일일 수 없어요
  if (entries === 0xffff || cdOffset === 0xffffffff) return true
  if (entries > MAX_ZIP_ENTRIES) return true
  let p = cdOffset
  let total = 0
  for (let k = 0; k < entries; k++) {
    if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) return false
    const size = dv.getUint32(p + 24, true)
    if (size === 0xffffffff || size > MAX_UNZIPPED_ENTRY_BYTES) return true
    total += size
    if (total > MAX_UNZIPPED_BYTES) return true
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return false
}
