// src/lib/abstract.js
class AbstractSource {
  single(options) {
    throw new Error("Source does not implement method #single()");
  }
  batch(options) {
    throw new Error("Source does not implement method #batch()");
  }
  movie(options) {
    throw new Error("Source does not implement method #movie()");
  }
  validate() {
    throw new Error("Source does not implement method #validate()");
  }
}

// src/lib/common.js
var PLATFORMS = {
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
};
var DEFAULT_PLATFORMS = ["crunchyroll", "bilibili", "youtube"];
function detectPlatforms(title) {
  return Object.keys(PLATFORMS).filter((key) => PLATFORMS[key].some((regex) => regex.test(title)));
}
var RESOLUTIONS = ["2160", "1080", "720", "540", "480"];
var RESOLUTION_ALIASES = { 2160: ["3840x2160", "4K"], 1080: ["1920x1080"], 720: ["1280x720"], 540: ["960x540"], 480: ["848x480", "640x480"] };
function titleResolution(title) {
  for (const res of RESOLUTIONS) {
    const aliases = [`${res}p`, ...RESOLUTION_ALIASES[res]].map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (new RegExp(`(?:^|[^\\dx])(?:${aliases.join("|")})(?![\\dx])`, "i").test(title))
      return res;
  }
  return null;
}
function postProcess(results, { exclusions = [], resolution }, settings = {}) {
  const platforms = settings.platforms ?? DEFAULT_PLATFORMS;
  const onlyPlatforms = settings.platformMode === "only";
  const lowerExclusions = exclusions.map((exclusion) => exclusion.toLowerCase());
  return results.filter((result) => {
    const lowerTitle = result.title.toLowerCase();
    if (lowerExclusions.some((exclusion) => lowerTitle.includes(exclusion)))
      return false;
    const stated = titleResolution(result.title);
    if (resolution && stated && stated !== resolution)
      return false;
    const preferred = detectPlatforms(result.title).some((platform) => platforms.includes(platform));
    if (onlyPlatforms && !preferred)
      return false;
    if (preferred && result.type !== "batch")
      result.type = "best";
    return true;
  });
}
function matchEpisode(title, episode) {
  const clean = title.replace(/\b(?:\d{3,4}p|\d{3,4}x\d{3,4}|[hx]\.?26[45]|10.?bit|AAC\d?\.?\d?|DDP?\d\.\d|E?AC-?3|S\d+(?!E))\b/gi, " ");
  for (const [, start, end] of clean.matchAll(/(?:^|[\s_[(])(?:E|EP|Ep)?(\d{1,4})\s*[-~]\s*(?:E|EP|Ep)?(\d{1,4})(?=$|[\s_\])\]v])/g)) {
    if (Number(start) < Number(end) && episode >= Number(start) && episode <= Number(end))
      return { match: true, batch: true };
  }
  const single = new RegExp(`(?:^|[\\s_\\[(#]|E|EP|Ep)0*${episode}(?:v\\d)?(?=$|[\\s_\\])\\.,'-])`);
  return { match: single.test(clean), batch: false };
}
function parseSize(text = "") {
  const match = text.match(/([\d.]+)\s*([KMGT]?i?B)/i);
  if (!match)
    return 0;
  const units = { B: 0, KIB: 1, KB: 1, MIB: 2, MB: 2, GIB: 3, GB: 3, TIB: 4, TB: 4 };
  return Number(match[1]) * 1024 ** (units[match[2].toUpperCase()] ?? 0);
}
function toHexHash(hash) {
  if (/^[a-f\d]{40}$/i.test(hash))
    return hash.toLowerCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of hash.toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  return bits.match(/.{4}/g).map((nibble) => parseInt(nibble, 2).toString(16)).join("");
}
async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function pickMirror(mirrors, probe = (base) => base) {
  for (const mirror of mirrors) {
    try {
      if ((await fetchWithTimeout(probe(mirror), 1e4)).ok)
        return mirror;
    } catch {}
  }
  return null;
}
function searchTitle(title) {
  return title.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
}

// src/subsplease.js
var subsplease_default = new class SubsPlease extends AbstractSource {
  url = "https://subsplease.org/api/";
  settings = {};
  async#search(term) {
    const response = await fetchWithTimeout(`${this.url}?${new URLSearchParams({ f: "search", tz: "UTC", s: term })}`);
    if (!response.ok)
      throw new Error(`SubsPlease responded with ${response.status}`);
    const json = await response.json();
    if (!json || Array.isArray(json))
      return [];
    return Object.values(json).map((entry) => ({ show: entry.show, episode: String(entry.episode), date: new Date(entry.release_date), magnets: entry.downloads ?? [] }));
  }
  async#titleSearch(titles = []) {
    for (const title of titles.slice(0, 5)) {
      const entries = await this.#search(searchTitle(title));
      if (entries.length)
        return entries;
    }
    return [];
  }
  #map(entries, type) {
    return entries.flatMap((entry) => entry.magnets.map(({ res, magnet }) => {
      const params = new URLSearchParams(magnet.slice(magnet.indexOf("?") + 1));
      const hash = params.get("xt")?.replace(/^urn:btih:/i, "");
      if (!hash)
        return null;
      return {
        title: params.get("dn") || `[SubsPlease] ${entry.show} - ${entry.episode} (${res}p)`,
        link: magnet,
        seeders: 0,
        leechers: 0,
        downloads: 0,
        hash: toHexHash(hash),
        size: Number(params.get("xl")) || 0,
        date: entry.date,
        accuracy: "medium",
        type
      };
    })).filter(Boolean);
  }
  #range(episode) {
    const match = episode.match(/^(\d+(?:\.\d+)?)(?:v\d+)?(?:\s*-\s*(\d+(?:\.\d+)?))?/);
    return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
  }
  async single(query) {
    const { titles, episode } = query;
    const entries = (await this.#titleSearch(titles)).filter((entry) => {
      const range = this.#range(entry.episode);
      return range && range[0] === range[1] && (episode == null || range[0] === episode);
    });
    return postProcess(this.#map(entries), query, this.settings);
  }
  async batch(query) {
    const { titles, episodeCount } = query;
    const entries = (await this.#titleSearch(titles)).filter((entry) => {
      const range = this.#range(entry.episode);
      return range && range[0] < range[1] && (!episodeCount || range[0] === 1 && range[1] === episodeCount);
    });
    return postProcess(this.#map(entries, "batch"), query, this.settings);
  }
  async movie() {
    return [];
  }
  async validate() {
    try {
      return (await fetchWithTimeout(`${this.url}?f=schedule&tz=UTC`, 1e4)).ok;
    } catch {
      return false;
    }
  }
};
export {
  subsplease_default as default
};
