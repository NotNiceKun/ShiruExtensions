import AbstractSource from './lib/abstract.js'
import { fetchWithTimeout, matchEpisode, parseSize, pickMirror, postProcess, searchTitle } from './lib/common.js'

/** @typedef {import('../index.d.ts').TorrentResult} TorrentResult */

const TRACKERS = ['http://nyaa.tracker.wf:7777/announce', 'udp://open.stealth.si:80/announce', 'udp://tracker.opentrackr.org:1337/announce', 'udp://exodus.desync.com:6969/announce', 'udp://tracker.torrent.eu.org:451/announce']

/**
 * Nyaa RSS source. Nyaa has no ID lookups, so results come from a title search and are matched on episode number.
 * Web workers have no DOMParser, so the RSS is parsed with regular expressions.
 */
export default new class Nyaa extends AbstractSource {
  mirrors = ['https://nyaa.si', 'https://nyaa.land']
  url = this.mirrors[0]
  settings = {}

  /**
   * @param {string} xml Item XML.
   * @param {string} tag Tag name.
   * @returns {string}
   */
  #tag(xml, tag) {
    const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? ''
    return value.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
  }

  /**
   * @param {string} term Search term.
   * @returns {Promise<TorrentResult[]>}
   */
  async #search(term) {
    const params = new URLSearchParams({ page: 'rss', q: term, c: this.settings.category || '1_2', f: this.settings.trustedOnly ? '2' : '0' })
    const response = await fetchWithTimeout(`${this.url}/?${params}`)
    if (!response.ok) throw new Error(`Nyaa responded with ${response.status}`)
    const xml = await response.text()
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const hash = this.#tag(item, 'nyaa:infoHash').toLowerCase()
      const title = this.#tag(item, 'title')
      if (!hash || !title) return null
      return {
        title,
        link: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS.map(tracker => `&tr=${encodeURIComponent(tracker)}`).join('')}`,
        id: Number(this.#tag(item, 'guid').match(/(\d+)$/)?.[1]) || undefined,
        seeders: Number(this.#tag(item, 'nyaa:seeders')) || 0,
        leechers: Number(this.#tag(item, 'nyaa:leechers')) || 0,
        downloads: Number(this.#tag(item, 'nyaa:downloads')) || 0,
        hash,
        size: parseSize(this.#tag(item, 'nyaa:size')),
        date: new Date(this.#tag(item, 'pubDate')),
        accuracy: 'low'
      }
    }).filter(Boolean)
  }

  /**
   * Searches the first few titles until one returns results.
   *
   * @param {string[]} titles
   * @param {string} suffix
   * @returns {Promise<TorrentResult[]>}
   */
  async #titleSearch(titles = [], suffix = '') {
    for (const title of titles.slice(0, 5)) {
      const results = await this.#search(`${searchTitle(title)} ${suffix}`.trim())
      if (results.length) return results
    }
    return []
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async single(query) {
    const { titles, episode } = query
    const suffix = episode != null ? String(episode).padStart(2, '0') : ''
    const results = (await this.#titleSearch(titles, suffix)).filter(result => {
      if (episode == null) return true
      const { match, batch } = matchEpisode(result.title, episode)
      if (batch) result.type = 'batch'
      else if (match) result.accuracy = 'medium'
      return match
    })
    return postProcess(results, query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async batch(query) {
    const results = (await this.#titleSearch(query.titles, 'batch')).map(result => ({ ...result, type: 'batch' }))
    return postProcess(results, query, this.settings)
  }

  /** @type {import('../index.d.ts').SearchFunction} */
  async movie(query) {
    return postProcess(await this.#titleSearch(query.titles), query, this.settings)
  }

  async validate() {
    const mirror = await pickMirror(this.mirrors, base => `${base}/?page=rss&q=test`)
    if (mirror) this.url = mirror
    return !!mirror
  }
}()
