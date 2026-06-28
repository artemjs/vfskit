import { describe, it, expect } from 'vitest'
import { s3, memoryS3 } from './index'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms = 2000) => { for (let t = 0; t < ms; t += 10) { if (cond()) return; await wait(10) } }

describe('s3 watch (polling)', () => {
  it('emits create, update and remove', async () => {
    const fs = s3({ client: memoryS3(), pollMs: 20 })
    const ev: string[] = []
    const off = fs.watch('/', (e) => ev.push(e.type + ':' + e.path))
    await wait(40)
    await fs.write('/a', '1')
    await until(() => ev.includes('create:/a'))
    await wait(30)
    await fs.write('/a', '22')
    await until(() => ev.some((e) => e === 'update:/a'))
    await fs.remove('/a')
    await until(() => ev.includes('remove:/a'))
    off()
    expect(ev).toContain('create:/a')
    expect(ev).toContain('update:/a')
    expect(ev).toContain('remove:/a')
  })
})
