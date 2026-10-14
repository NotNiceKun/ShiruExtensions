/** @typedef {import('../../index.d.ts').TorrentSource} TorrentSource */

/** @implements {TorrentSource} */
export default class AbstractSource {
  /**
   * Query results for a single episode.
   * @type {import('../../index.d.ts').SearchFunction}
   */
  single (options) {
    throw new Error('Source does not implement method #single()')
  }

  /**
   * Query results for a batch of episodes.
   * @type {import('../../index.d.ts').SearchFunction}
   */
  batch (options) {
    throw new Error('Source does not implement method #batch()')
  }

  /**
   * Query results for a movie.
   * @type {import('../../index.d.ts').SearchFunction}
   */
  movie (options) {
    throw new Error('Source does not implement method #movie()')
  }

  /**
   * Validates the source url. If you require user configuration for settings, you should validate this.settings here.
   * @type {Promise<boolean>}
   */
  validate () {
    throw new Error('Source does not implement method #validate()')
  }
}