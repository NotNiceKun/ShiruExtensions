import { expect, test } from 'bun:test'
import { matchEpisode, detectPlatforms, postProcess, toHexHash } from '../src/lib/common.js'
const cases = [
  ['[SubsPlease] Sousou no Frieren - 05 (1080p) [ABC].mkv', 5, true, false],
  ['[SubsPlease] Sousou no Frieren - 15 (1080p)', 5, false, false],
  ['[SubsPlease] Sousou no Frieren - 05v2 (1080p)', 5, true, false],
  ['Frieren S01E05 1080p CR WEB-DL x264', 5, true, false],
  ['Frieren S01E05 1080p CR WEB-DL x264', 1, false, false],
  ['[Erai-raws] Show - 01 ~ 28 [1080p]', 5, true, true],
  ['[9volt] Show - 17-28 (Cour 2) (WEB 1080p)', 5, false, false],
  ['[X] Show - 05 [1080p HEVC 10bit AAC2.0]', 10, false, false],
  ['[X] Show - 264 [1080p]', 264, true, false],
  ['[X] Show S2 - 02 [720p x265]', 2, true, false],
  ['[X] Show S2 - 03 [720p x265]', 2, false, false],
  ['[Dynamis One] Back as Immortal Lord - 12 (B-Global Donghua 1920x1080 HEVC AAC MKV)', 12, true, false],
]
for (const [title, ep, match, batch] of cases) test(`${title} ep${ep}`, () => expect(matchEpisode(title, ep)).toEqual({ match, batch }))
test('platforms', () => {
  expect(detectPlatforms('[Dynamis One] X - 12 (B-Global Donghua 1920x1080)')).toEqual(['bilibili'])
  expect(detectPlatforms('[Piyoko] X - 23 [WEB 1080p YT VP9 AAC 2.0]')).toEqual(['youtube'])
  expect(detectPlatforms('Show.S01E05.1080p.NF.WEB-DL')).toEqual(['netflix'])
  expect(detectPlatforms('[ToonsHub] Show S01E28 1080p CR WEB-DL')).toEqual(['crunchyroll'])
  expect(detectPlatforms('[Group] Crunchy Script Accident - 01')).toEqual([])
  expect(detectPlatforms('[Group] Show - 01 [BD 1080p]')).toEqual([])
})
test('postProcess', () => {
  const mk = title => ({ title, hash: 'a'.repeat(40) })
  const res = [mk('A - 01 [1080p CR]'), mk('A - 01 [720p CR]'), mk('A - 01 [1080p BD HEVC]'), mk('A - 01 [B-Global 1920x1080]')]
  expect(postProcess(res.map(r => ({ ...r })), { resolution: '1080', exclusions: [] }, {}).map(r => [r.title, r.type])).toEqual([['A - 01 [1080p CR]', 'best'], ['A - 01 [1080p BD HEVC]', undefined], ['A - 01 [B-Global 1920x1080]', 'best']])
  expect(postProcess(res.map(r => ({ ...r })), { resolution: '', exclusions: ['HEVC'] }, { platformMode: 'only', platforms: ['bilibili'] }).map(r => r.title)).toEqual(['A - 01 [B-Global 1920x1080]'])
})
test('base32 hash', () => expect(toHexHash('VLJ3XGIWPFSZPFC3WRVIL2UCEQFHAW2B')).toMatch(/^[a-f\d]{40}$/))
