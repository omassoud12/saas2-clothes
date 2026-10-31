import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {activeFitCuts,fitCutSource as seed,normalizeText} from '../.test-dist/voice-sales/index.js'
import {parseVoiceSaleText} from '../.test-dist/voice-sales/parser.js'
import {scanFitCuts} from '../.test-dist/voice-sales/fit-cut-parser.js'
const kit=new URL('../../SAAS2_Fits_Cuts_Dictionary_Integration_Kit/',import.meta.url)
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',kit)))
const integrity=Object.entries(manifest.kit_sha256_files).map(([name,expected])=>{
  const actual=createHash('sha256').update(fs.readFileSync(new URL(name,kit))).digest('hex')
  if (actual!==expected) throw Error(`Integrity mismatch: ${name}`)
  return {name,expected,actual,verified:true}
})
const groups=new Map()
for (const row of activeFitCuts.audit.filter(r=>r.disposition!=='blocked')) {
  const entries=groups.get(row.normalized)??[];entries.push(row);groups.set(row.normalized,entries)
}
const collisions=[...groups].filter(([,rows])=>new Set(rows.map(r=>r.domain+':'+r.id)).size>1)
  .map(([normalized,rows])=>({normalized,candidates:[...new Set(rows.map(r=>r.id))],domains:[...new Set(rows.map(r=>r.domain))]}))
const sourceCases=seed.test_cases.map(row=>{
  const p=parseVoiceSaleText(row.input_text)
  const recognized=[...new Set(scanFitCuts(row.input_text).filter(r=>r.polarity==='affirmative').flatMap(r=>r.result.styles))]
  return {...row,recognized,missingSourceExpectations:row.expected_style_ids.filter(id=>!recognized.includes(id)),
    additionalAlternatives:recognized.filter(id=>!row.expected_style_ids.includes(id)),parserStatus:p.status,
    sourceFitCuts:p.sourceFitCuts,fitCutCandidates:p.fitCutCandidates,quantity:p.attributes.quantity.value,size:p.attributes.size.value}
})
const report={manifestIntegrity:integrity,originalArchiveHash:manifest.source_archive_sha256,
  originalArchiveIndependentlyVerified:false,provenance:seed.meta,coverage:activeFitCuts.coverage,
  axes:seed.groups.map(g=>({axis:g.group,concepts:seed.styles.filter(r=>r.group===g.group).length})),
  audit:activeFitCuts.audit,normalizationDifferences:activeFitCuts.audit.filter(r=>r.normalized!==r.sourceNormalized),
  crossDomainRecords:activeFitCuts.audit.filter(r=>r.crossDomains.length),runtimeCollisions:collisions,
  sourceAmbiguities:seed.ambiguities,sourceCollisions:seed.collisions,
  duplicateNormalizedIdentityRecords:activeFitCuts.audit.length-new Set(activeFitCuts.audit.map(r=>r.domain+':'+r.id+':'+r.normalized)).size,
  conceptAliasCountDiscrepancies:seed.styles.filter(c=>seed.style_aliases.filter(r=>r.style_id===c.style_id).length!==c.alias_count),sourceCases}
fs.writeFileSync(new URL('../src/voice-sales/FITS_CUTS_AUDIT.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({coverage:report.coverage,integrityFiles:integrity.length,normalizationDifferences:report.normalizationDifferences.length,
  crossDomainRecords:report.crossDomainRecords.length,collisionKeys:collisions.length,duplicateRecords:report.duplicateNormalizedIdentityRecords,
  conceptCountDiscrepancies:report.conceptAliasCountDiscrepancies.length,
  sourceCases:sourceCases.length,sourceExpectationDifferences:sourceCases.filter(r=>r.missingSourceExpectations.length||r.additionalAlternatives.length).map(r=>({text:r.input_text,missing:r.missingSourceExpectations,additional:r.additionalAlternatives}))},null,2))
