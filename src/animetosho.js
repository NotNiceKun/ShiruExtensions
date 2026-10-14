import AbstractSource from './lib/abstract.js'
import { fetchWithTimeout, matchEpisode, pickMirror, postProcess, searchTitle } from './lib/common.js'

/** @typedef {import('../index.d.ts').TorrentResult} TorrentResult */
/** @typedef {import('../index.d.ts').TorrentQuery} TorrentQuery */

/**
 * AnimeTosho JSON feed source. AnimeTosho tags most releases with their AniDB anime/episode IDs,
 * so ID lookups give exact matches; a title search is used as a fallback for untagged releases.
 */
export default new class AnimeTosho extends AbstractSource {
  mirrors = ['https://feed.animetosho.org/json', 'https://animetosho.org/feed/json', 'https://feed.animetosho.net/json']
  url = this.mirrors[0]
  settings = {}

  /**
   * @param {Record<string, string|number>} params
   * @returns {Promise<any[]>}
   */
  async #fetch(params) {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
    const response = await fetchWithTimeout(`${this.url}?${search}`)
    if (!response.ok) throw new Error(`AnimeTosho responded with ${response.status}`)
    const json = await response.json()
    return Array.isArray(json) ? json : []
  }

  /**
   * @param {any} entry AnimeTosho feed entry.
   * @param {TorrentResult['accuracy']} accuracy
   * @param {TorrentResult['type']} [type]
   * @returns {TorrentResult|null}
   */
  #map(entry, accuracy, type) {
    if (!entry?.info_hash || !entry?.title) return null
    return {
      title: entry.title,
      link: entry.magnet_uri || entry.torrent_url,
      id: entry.nyaa_id ?? entry.id,
      seeders: entry.seeders >= 30_000 ? 0 : (entry.seeders ?? 0),
      leechers: entry.leechers >= 30_000 ? 0 : (entry.leechers ?? 0),
      downloads: entry.torrent_downloaded_count ?? 0,
      hash: entry.info_hash.toLowerCase(),
      size: entry.total_size ?? 0,
      date: new Date(entry.timestamp * 1000),
      accuracy,
      type
    }
  }

  /**
   * Searches the first few titles until one returns results.
   *
   * @param {string[]} titles
   * @param {string} suffix Appended to the title, e.g. the episode number.
   * @returns {Promise<any[]>}
   */
  async #titleSearch(titles = [], suffix = '') {
    for (const title of titles.slice(0, 5)) {
      const entries = await this.#fetch({ q: `${searchTitle(title)} ${suffix}`.trim(), qx: 1 })
      if (entries.length) return entries
    }
    return []
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async single(query) {
    const { anidbEid, anidbAid, titles, episode } = query
    /** @type {(TorrentResult|null)[]} */
    let results = []
    if (anidbEid) results = (await this.#fetch({ eid: anidbEid })).map(entry => this.#map(entry, 'high'))
    if (!results.length && anidbAid && episode != null) {
      results = (await this.#fetch({ aid: anidbAid }))
        .filter(entry => entry.num_files === 1 && matchEpisode(entry.title, episode).match)
        .map(entry => this.#map(entry, 'medium'))
    }
    if (!results.length && (this.settings.titleFallback ?? true)) {
      const suffix = episode != null ? String(episode).padStart(2, '0') : ''
      results = (await this.#titleSearch(titles, suffix))
        .filter(entry => episode == null || matchEpisode(entry.title, episode).match)
        .map(entry => this.#map(entry, 'low', episode != null && matchEpisode(entry.title, episode).batch ? 'batch' : undefined))
    }
    return postProcess(results.filter(Boolean), query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async batch(query) {
    const { anidbAid, titles } = query
    let results = []
    if (anidbAid) results = (await this.#fetch({ aid: anidbAid })).filter(entry => entry.num_files > 1).map(entry => this.#map(entry, 'high', 'batch'))
    if (!results.length && (this.settings.titleFallback ?? true)) {
      results = (await this.#titleSearch(titles, 'batch')).filter(entry => entry.num_files > 1).map(entry => this.#map(entry, 'low', 'batch'))
    }
    return postProcess(results.filter(Boolean), query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async movie(query) {
    const { anidbAid, titles } = query
    let results = []
    if (anidbAid) results = (await this.#fetch({ aid: anidbAid })).map(entry => this.#map(entry, 'high'))
    if (!results.length && (this.settings.titleFallback ?? true)) results = (await this.#titleSearch(titles)).map(entry => this.#map(entry, 'low'))
    return postProcess(results.filter(Boolean), query, this.settings)
  }

  async validate() {
    const mirror = await pickMirror(this.mirrors, base => `${base}?q=test`)
    if (mirror) this.url = mirror
    return !!mirror
  }
}()
