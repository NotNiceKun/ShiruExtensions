import AbstractSource from './lib/abstract.js'
import { fetchWithTimeout, postProcess, searchTitle, toHexHash } from './lib/common.js'

/** @typedef {import('../index.d.ts').TorrentResult} TorrentResult */

/**
 * SubsPlease API source. SubsPlease rips simulcasts (mostly Crunchyroll), and its API returns
 * magnets per resolution. It doesn't report peers; Shiru scrapes the trackers itself.
 */
export default new class SubsPlease extends AbstractSource {
  url = 'https://subsplease.org/api/'
  settings = {}

  /**
   * @param {string} term Show name.
   * @returns {Promise<{ show: string, episode: string, date: Date, magnets: { res: string, magnet: string }[] }[]>}
   */
  async #search(term) {
    const response = await fetchWithTimeout(`${this.url}?${new URLSearchParams({ f: 'search', tz: 'UTC', s: term })}`)
    if (!response.ok) throw new Error(`SubsPlease responded with ${response.status}`)
    const json = await response.json()
    if (!json || Array.isArray(json)) return [] // the API returns [] when nothing matches
    return Object.values(json).map(entry => ({ show: entry.show, episode: String(entry.episode), date: new Date(entry.release_date), magnets: entry.downloads ?? [] }))
  }

  /**
   * Searches the first few titles until one returns results.
   *
   * @param {string[]} titles
   */
  async #titleSearch(titles = []) {
    for (const title of titles.slice(0, 5)) {
      const entries = await this.#search(searchTitle(title))
      if (entries.length) return entries
    }
    return []
  }

  /**
   * @param {{ show: string, episode: string, date: Date, magnets: { res: string, magnet: string }[] }[]} entries
   * @param {TorrentResult['type']} [type]
   * @returns {TorrentResult[]}
   */
  #map(entries, type) {
    return entries.flatMap(entry => entry.magnets.map(({ res, magnet }) => {
      const params = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1))
      const hash = params.get('xt')?.replace(/^urn:btih:/i, '')
      if (!hash) return null
      return {
        title: params.get('dn') || `[SubsPlease] ${entry.show} - ${entry.episode} (${res}p)`,
        link: magnet,
        seeders: 0,
        leechers: 0,
        downloads: 0,
        hash: toHexHash(hash),
        size: Number(params.get('xl')) || 0,
        date: entry.date,
        accuracy: 'medium',
        type
      }
    })).filter(Boolean)
  }

  /**
   * @param {string} episode SubsPlease episode label, e.g. "05", "05v2", "01-12".
   * @returns {[number, number]|null} The episode range it covers.
   */
  #range(episode) {
    const match = episode.match(/^(\d+(?:\.\d+)?)(?:v\d+)?(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async single(query) {
    const { titles, episode } = query
    const entries = (await this.#titleSearch(titles)).filter(entry => {
      const range = this.#range(entry.episode)
      return range && range[0] === range[1] && (episode == null || range[0] === episode)
    })
    return postProcess(this.#map(entries), query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async batch(query) {
    const { titles, episodeCount } = query
    const entries = (await this.#titleSearch(titles)).filter(entry => {
      const range = this.#range(entry.episode)
      // A search can also hit other seasons of the show, so only keep batches spanning the whole season when its length is known.
      return range && range[0] < range[1] && (!episodeCount || (range[0] === 1 && range[1] === episodeCount))
    })
    return postProcess(this.#map(entries, 'batch'), query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async movie() {
    return [] // SubsPlease labels movies like episodes, so they can't be told apart reliably
  }

  async validate() {
    try {
      return (await fetchWithTimeout(`${this.url}?f=schedule&tz=UTC`, 10_000)).ok
    } catch {
      return false
    }
  }
}()
