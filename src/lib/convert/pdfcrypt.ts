/**
 * 보안이 걸린 PDF 가 '암호 없이 열리는지' 확인해요.
 * PDF 보안에는 두 가지가 있어요.
 *   - 소유자 암호만: 인쇄·복사만 막고 누구나 열 수 있어요 (관공서 PDF 에 흔해요) → 그대로 올려도 돼요
 *   - 사용자(여는) 암호: 암호를 알아야 열려요 → 올리면 아무도 못 보니 막아요
 * PDF 표준(ISO 32000)의 '빈 사용자 암호' 확인 방법(R2~R6)을 그대로 따라 해요.
 */
import type { PDFDocument } from 'pdf-lib'

type PdfLib = typeof import('pdf-lib')

// 표준이 정한 32바이트 채움 값
const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68,
  0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array, n: number) => a.length >= n && b.length >= n && a.subarray(0, n).every((v, i) => v === b[i])

/** RC4 (R2~R4 확인용) */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

/** MD5 (R2~R4 확인용. 브라우저 기본 암호 기능에는 MD5 가 없어요) */
function md5(data: Uint8Array): Uint8Array {
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const len = data.length
  const total = (((len + 8) >> 6) + 1) << 6
  const buf = new Uint8Array(total)
  buf.set(data)
  buf[len] = 0x80
  const bits = len * 8
  const dv = new DataView(buf.buffer)
  dv.setUint32(total - 8, bits >>> 0, true)
  dv.setUint32(total - 4, Math.floor(bits / 2 ** 32), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      const x = (a + f + K[i] + M[g]) >>> 0
      const r = S[(i >> 4) * 4 + (i % 4)]
      b = (b + ((x << r) | (x >>> (32 - r)))) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ;[a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true))
  return out
}

async function sha(alg: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(alg, data as BufferSource))
}

/** R6 의 해시 (ISO 32000-2 Algorithm 2.B), 빈 암호·사용자 확인용 */
async function hash2B(salt: Uint8Array): Promise<Uint8Array> {
  let k = await sha('SHA-256', salt)
  for (let round = 0; ; round++) {
    const k1 = new Uint8Array(k.length * 64)
    for (let i = 0; i < 64; i++) k1.set(k, i * k.length)
    const key = await crypto.subtle.importKey('raw', k.subarray(0, 16) as BufferSource, 'AES-CBC', false, ['encrypt'])
    // 브라우저 AES-CBC 는 끝에 채움 블록을 붙이니 원래 길이만 써요
    const e = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: k.subarray(16, 32) as BufferSource }, key, k1 as BufferSource)).subarray(0, k1.length)
    let sum = 0
    for (let i = 0; i < 16; i++) sum += e[i]
    const m = sum % 3
    k = await sha(m === 0 ? 'SHA-256' : m === 1 ? 'SHA-384' : 'SHA-512', e)
    // 64번 넘게 돌았고 E 의 마지막 바이트가 (돈 횟수 - 32) 이하면 끝
    if (round + 1 >= 64 && e[e.length - 1] <= round + 1 - 32) break
  }
  return k.subarray(0, 32)
}

/** 암호 없이 열리는 PDF 면 true. 알 수 없는 방식이면 false (안전하게 막아요) */
export async function opensWithoutPassword(doc: PDFDocument, lib: PdfLib): Promise<boolean> {
  try {
    const ctx = doc.context
    const encRef = ctx.trailerInfo.Encrypt
    if (!encRef) return true
    const enc = ctx.lookup(encRef)
    if (!(enc instanceof lib.PDFDict)) return false
    const name = (k: string) => {
      const v = enc.lookup(lib.PDFName.of(k))
      return v instanceof lib.PDFName ? v.asString() : undefined
    }
    const num = (k: string) => {
      const v = enc.lookup(lib.PDFName.of(k))
      return v instanceof lib.PDFNumber ? v.asNumber() : undefined
    }
    const bytes = (v: unknown) => (v instanceof lib.PDFString || v instanceof lib.PDFHexString ? v.asBytes() : undefined)
    if (name('Filter') !== '/Standard') return false
    const R = num('R') ?? 0
    const V = num('V') ?? 0
    const O = bytes(enc.lookup(lib.PDFName.of('O')))
    const U = bytes(enc.lookup(lib.PDFName.of('U')))
    if (!O || !U) return false

    if (R === 5 || R === 6) {
      if (!globalThis.crypto?.subtle || U.length < 48) return false
      const vsalt = U.subarray(32, 40)
      const h = R === 5 ? await sha('SHA-256', vsalt) : await hash2B(vsalt)
      return sameBytes(h, U, 32)
    }
    if (R < 2 || R > 4) return false

    const P = num('P') ?? 0
    const pBytes = new Uint8Array(4)
    new DataView(pBytes.buffer).setInt32(0, P | 0, true)
    const idObj = ctx.trailerInfo.ID
    const idArr: unknown = idObj ? ctx.lookup(idObj) : undefined
    const id0 = idArr instanceof lib.PDFArray ? (bytes(idArr.lookup(0)) ?? new Uint8Array(0)) : new Uint8Array(0)
    let lengthBits = num('Length') ?? (V >= 4 ? 128 : 40)
    if (lengthBits <= 16) lengthBits *= 8 // 가끔 바이트 단위로 적혀 있어요
    const n = R === 2 ? 5 : Math.max(5, Math.min(16, Math.floor(lengthBits / 8)))
    const encMeta = enc.lookup(lib.PDFName.of('EncryptMetadata'))
    const noMeta = R >= 4 && encMeta instanceof lib.PDFBool && !encMeta.asBoolean()
    let h = md5(concat(PAD, O.subarray(0, 32), pBytes, id0, noMeta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)))
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n))
    const key = h.subarray(0, n)
    if (R === 2) return sameBytes(rc4(key, PAD), U, 32)
    let x = rc4(key, md5(concat(PAD, id0)))
    for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x)
    return sameBytes(x, U, 16)
  } catch {
    return false
  }
}
