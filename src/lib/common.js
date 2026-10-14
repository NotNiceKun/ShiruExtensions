/** @typedef {import('../../index.d.ts').TorrentResult} TorrentResult */
/** @typedef {import('../../index.d.ts').TorrentQuery} TorrentQuery */

/**
 * Streaming platforms that anime WEB releases are ripped from, keyed by the value used in the manifest settings.
 * Short release tags (CR, YT, NF...) are matched case-sensitively so ordinary words don't trigger them.
 */
export const PLATFORMS = {
  crunchyroll: [/\bCR\b/, /\bCrunchy[Rr]oll\b/i, /^\[SubsPlease\]/i],
  bilibili: [/\bB-?Global\b/i, /\bBili(?:bili)?\b/i, /\bBstation\b/i],
  youtube: [/\bYT\b/, /\bYouTube\b/i],
  netflix: [/\bNF\b/, /\bNetflix\b/i],
  amazon: [/\bAMZN\b/, /\bAmazon\b/i],
  disney: [/\bDSNP\b/, /\bDisney\b/i],
  hidive: [/\bHIDI(?:VE)?\b/i],
  adn: [/\bADN\b/],
  bahamut: [/\bBaha(?:mut)?\b/i],
  iqiyi: [/\biQIYI\b/i],
  abema: [/\bABEMA\b/i]
}

export const DEFAULT_PLATFORMS = ['crunchyroll', 'bilibili', 'youtube']

/**
 * @param {string} title Release title.
 * @returns {string[]} Keys of every platform the release title is tagged with.
 */
export function detectPlatforms(title) {
  return Object.keys(PLATFORMS).filter(key => PLATFORMS[key].some(regex => regex.test(title)))
}

const RESOLUTIONS = ['2160', '1080', '720', '540', '480']
const RESOLUTION_ALIASES = { 2160: ['3840x2160', '4K'], 1080: ['1920x1080'], 720: ['1280x720'], 540: ['960x540'], 480: ['848x480', '640x480'] }

/**
 * @param {string} title Release title.
 * @returns {string|null} The resolution the title explicitly states, if any.
 */
function titleResolution(title) {
  for (const res of RESOLUTIONS) {
    const aliases = [`${res}p`, ...RESOLUTION_ALIASES[res]].map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    if (new RegExp(`(?:^|[^\\dx])(?:${aliases.join('|')})(?![\\dx])`, 'i').test(title)) return res
  }
  return null
}

/**
 * Applies the filters every source shares: player exclusions (codecs the player can't decode),
 * the requested resolution, and the streaming platform preference from the extension settings.
 *
 * @param {TorrentResult[]} results Raw source results.
 * @param {TorrentQuery} query The Shiru query.
 * @param {Record<string, any>} settings The extension settings.
 * @returns {TorrentResult[]}
 */
export function postProcess(results, { exclusions = [], resolution }, settings = {}) {
  const platforms = settings.platforms ?? DEFAULT_PLATFORMS
  const onlyPlatforms = settings.platformMode === 'only'
  const lowerExclusions = exclusions.map(exclusion => exclusion.toLowerCase())

  return results.filter(result => {
    const lowerTitle = result.title.toLowerCase()
    if (lowerExclusions.some(exclusion => lowerTitle.includes(exclusion))) return false
    const stated = titleResolution(result.title)
    if (resolution && stated && stated !== resolution) return false
    const preferred = detectPlatforms(result.title).some(platform => platforms.includes(platform))
    if (onlyPlatforms && !preferred) return false
    if (preferred && result.type !== 'batch') result.type = 'best'
    return true
  })
}

/**
 * Checks whether a release title refers to a given episode, either directly or as part of a range.
 *
 * @param {string} title Release title.
 * @param {number} episode Episode number.
 * @returns {{ match: boolean, batch: boolean }}
 */
export function matchEpisode(title, episode) {
  const clean = title.replace(/\b(?:\d{3,4}p|\d{3,4}x\d{3,4}|[hx]\.?26[45]|10.?bit|AAC\d?\.?\d?|DDP?\d\.\d|E?AC-?3|S\d+(?!E))\b/gi, ' ')
  for (const [, start, end] of clean.matchAll(/(?:^|[\s_[(])(?:E|EP|Ep)?(\d{1,4})\s*[-~]\s*(?:E|EP|Ep)?(\d{1,4})(?=$|[\s_\])\]v])/g)) {
    if (Number(start) < Number(end) && episode >= Number(start) && episode <= Number(end)) return { match: true, batch: true }
  }
  const single = new RegExp(`(?:^|[\\s_\\[(#]|E|EP|Ep)0*${episode}(?:v\\d)?(?=$|[\\s_\\])\\.,'-])`)
  return { match: single.test(clean), batch: false }
}

/**
 * @param {string} text A size like "13.7 GiB".
 * @returns {number} Size in bytes.
 */
export function parseSize(text = '') {
  const match = text.match(/([\d.]+)\s*([KMGT]?i?B)/i)
  if (!match) return 0
  const units = { B: 0, KIB: 1, KB: 1, MIB: 2, MB: 2, GIB: 3, GB: 3, TIB: 4, TB: 4 }
  return Number(match[1]) * 1024 ** (units[match[2].toUpperCase()] ?? 0)
}

/**
 * Converts a base32 BitTorrent info hash (as used in some magnets) to hex.
 *
 * @param {string} hash 32 char base32 or 40 char hex info hash.
 * @returns {string} 40 char lowercase hex info hash.
 */
export function toHexHash(hash) {
  if (/^[a-f\d]{40}$/i.test(hash)) return hash.toLowerCase()
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of hash.toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  return bits.match(/.{4}/g).map(nibble => parseInt(nibble, 2).toString(16)).join('')
}

/**
 * Fetches with a timeout so one stalled mirror can't hang the whole query.
 *
 * @param {string} url
 * @param {number} timeout Milliseconds.
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, timeout = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns the first mirror that responds OK, so the source can fail over when a domain is blocked.
 *
 * @param {string[]} mirrors Base URLs in order of preference.
 * @param {(base: string) => string} probe Builds the URL used to test a mirror.
 * @returns {Promise<string|null>}
 */
export async function pickMirror(mirrors, probe = base => base) {
  for (const mirror of mirrors) {
    try {
      if ((await fetchWithTimeout(probe(mirror), 10_000)).ok) return mirror
    } catch {}
  }
  return null
}

/**
 * Removes characters that tend to break indexer search engines.
 *
 * @param {string} title
 * @returns {string}
 */
export function searchTitle(title) {
  return title.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim()
}
