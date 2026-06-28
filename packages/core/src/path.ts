const SEP = '/'

export function normalize(p: string): string {
  const out: string[] = []
  for (const part of p.split(SEP)) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return SEP + out.join(SEP)
}

export function join(...parts: string[]): string {
  return normalize(parts.join(SEP))
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf(SEP)
  return i <= 0 ? SEP : n.slice(0, i)
}

export function basename(p: string): string {
  const n = normalize(p)
  return n.slice(n.lastIndexOf(SEP) + 1)
}

export function segments(p: string): string[] {
  return normalize(p).split(SEP).filter(Boolean)
}
