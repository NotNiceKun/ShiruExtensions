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

// src/nyaa.js
var TRACKERS = ["http://nyaa.tracker.wf:7777/announce", "udp://open.stealth.si:80/announce", "udp://tracker.opentrackr.org:1337/announce", "udp://exodus.desync.com:6969/announce", "udp://tracker.torrent.eu.org:451/announce"];
var nyaa_default = new class Nyaa extends AbstractSource {
  mirrors = ["https://nyaa.si", "https://nyaa.land"];
  url = this.mirrors[0];
  settings = {};
  #tag(xml, tag) {
    const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
    return value.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  }
  async#search(term) {
    const params = new URLSearchParams({ page: "rss", q: term, c: this.settings.category || "1_2", f: this.settings.trustedOnly ? "2" : "0" });
    const response = await fetchWithTimeout(`${this.url}/?${params}`);
    if (!response.ok)
      throw new Error(`Nyaa responded with ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const hash = this.#tag(item, "nyaa:infoHash").toLowerCase();
      const title = this.#tag(item, "title");
      if (!hash || !title)
        return null;
      return {
        title,
        link: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS.map((tracker) => `&tr=${encodeURIComponent(tracker)}`).join("")}`,
        id: Number(this.#tag(item, "guid").match(/(\d+)$/)?.[1]) || undefined,
        seeders: Number(this.#tag(item, "nyaa:seeders")) || 0,
        leechers: Number(this.#tag(item, "nyaa:leechers")) || 0,
        downloads: Number(this.#tag(item, "nyaa:downloads")) || 0,
        hash,
        size: parseSize(this.#tag(item, "nyaa:size")),
        date: new Date(this.#tag(item, "pubDate")),
        accuracy: "low"
      };
    }).filter(Boolean);
  }
  async#titleSearch(titles = [], suffix = "") {
    for (const title of titles.slice(0, 5)) {
      const results = await this.#search(`${searchTitle(title)} ${suffix}`.trim());
      if (results.length)
        return results;
    }
    return [];
  }
  async single(query) {
    const { titles, episode } = query;
    const suffix = episode != null ? String(episode).padStart(2, "0") : "";
    const results = (await this.#titleSearch(titles, suffix)).filter((result) => {
      if (episode == null)
        return true;
      const { match, batch } = matchEpisode(result.title, episode);
      if (batch)
        result.type = "batch";
      else if (match)
        result.accuracy = "medium";
      return match;
    });
    return postProcess(results, query, this.settings);
  }
  async batch(query) {
    const results = (await this.#titleSearch(query.titles, "batch")).map((result) => ({ ...result, type: "batch" }));
    return postProcess(results, query, this.settings);
  }
  async movie(query) {
    return postProcess(await this.#titleSearch(query.titles), query, this.settings);
  }
  async validate() {
    const mirror = await pickMirror(this.mirrors, (base) => `${base}/?page=rss&q=test`);
    if (mirror)
      this.url = mirror;
    return !!mirror;
  }
};
export {
  nyaa_default as default
};
