# Shiru Platform Extensions

Torrent sources for [Shiru](https://github.com/RockinChaos/Shiru) that prefer WEB releases ripped from
streaming platforms: Crunchyroll, Bilibili (B-Global), YouTube, Netflix, Amazon, Disney+, HIDIVE, ADN,
Bahamut, iQIYI and ABEMA.

Shiru extensions can only return torrents (every result is played through WebTorrent), so these sources
find torrents of a platform's release rather than streaming from the platform itself.

| Source       | Matching                                              | Notes                                   |
|--------------|-------------------------------------------------------|-----------------------------------------|
| AnimeTosho+  | AniDB episode/anime IDs, title search fallback         | Most accurate; fails over across mirrors |
| Nyaa+        | Title search + episode number matching                 | Category and trusted-only settings       |
| SubsPlease   | SubsPlease API, filtered by episode / full-season batch | All releases are Crunchyroll rips        |

## Settings (all sources)

- **Preferred Platforms**: platforms detected from release tags (`CR`, `B-Global`, `YT`, `NF`, `AMZN`...).
- **Platform Mode**: `Prefer` marks matching releases as **Best** (Shiru ranks those first);
  `Only` hides everything else.

The requested resolution and the codecs Shiru reports the player can't decode are filtered out too.

## Install

- **Local**: in Shiru, add an extension source pointing at this folder's `index.json`.
- **GitHub**: add `gh:NotNiceKun/ShiruExtensions` as an extension source in Shiru.

## Develop

Requires [Bun](https://bun.sh). Edit `src/`, never `sources/` (it's generated).

```sh
bun run build   # bundle src/*.js into self-contained sources/*.js (Shiru can't resolve relative imports)
bun run test    # unit tests for episode / platform / resolution matching
bun run smoke   # live queries against every source; EID=<anidb eid> EP=<episode> to change the target
```

Bump `version` in `index.json` after changing a source so Shiru picks up the update.
