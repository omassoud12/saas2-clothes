import { copyFileSync, mkdirSync } from 'node:fs'

// Explicit allowlist: only immutable vocabulary resources enter the build artifact.
const source = new URL('../resources/voice-sales/', import.meta.url)
const destination = new URL('../dist/resources/voice-sales/', import.meta.url)
mkdirSync(destination, { recursive: true })
for (const name of ['product-types.seed.json', 'product-types.ambiguous.json', 'colors.seed.json', 'colors.source-collisions.json', 'sizes.seed.json', 'sizes.source-collisions.json', 'quantities.seed.json', 'quantities.source-collisions.json', 'materials.seed.json', 'materials.source-collisions.json', 'necklines.seed.json', 'necklines.source-collisions.json', 'common-expressions.seed.json', 'common-expressions.collisions.json', 'common-expressions.ambiguities.json', 'fits-cuts.seed.json', 'fits-cuts.source-collisions.json', 'patterns.seed.json', 'patterns.source-collisions.json']) {
  copyFileSync(new URL(name, source), new URL(name, destination))
}
