// Live smoke test: loads the built bundles the way Shiru does (default export) and runs real queries.
// Usage: bun scripts/smoke.js [animetosho|nyaa|subsplease]
const query = {
  anilistId: 154587,
  anidbAid: 17617,
  anidbEid: Number(process.env.EID) || undefined,
  titles: ['Sousou no Frieren', "Frieren: Beyond Journey's End"],
  episode: Number(process.env.EP) || 5,
  episodeCount: 28,
  resolution: '1080',
  exclusions: []
}
const only = process.argv[2]
for (const name of ['animetosho', 'nyaa', 'subsplease'].filter(name => !only || name === only)) {
  const source = (await import(`../sources/${name}.js`)).default
  source.settings = { platforms: ['crunchyroll', 'bilibili', 'youtube'], platformMode: 'prefer' }
  const valid = await source.validate()
  console.log(`\n== ${name}: validate=${valid} url=${source.url}`)
  if (!valid) continue
  for (const kind of ['single', 'batch', 'movie']) {
    try {
      const results = await source[kind](query)
      const bad = results.filter(r => !/^[a-f\d]{40}$/.test(r.hash) || !r.link || !(r.date instanceof Date) || isNaN(r.date))
      console.log(`  ${kind}: ${results.length} results, ${results.filter(r => r.type === 'best').length} best, ${bad.length} malformed`)
      for (const r of results.slice(0, 4)) console.log(`    [${r.accuracy}/${r.type ?? '-'}] ${r.title} (${(r.size / 2 ** 30).toFixed(2)} GiB, S${r.seeders})`)
    } catch (error) {
      console.log(`  ${kind}: ERROR ${error.message}`)
    }
  }
}
