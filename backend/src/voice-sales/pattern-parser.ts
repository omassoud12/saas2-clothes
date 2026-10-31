import { activePatterns, activeProductTypes, activeMaterials, activeColors, activeNecklines, activeFitCuts, tokenizeText, normalizeText } from './index.js'
import { scanSourceSizes } from './size-parser.js'
import { freezePattern } from './pattern-source.js'
import type { ParsedPatternMatch } from './pattern.types.js'
import type { ParsedAttribute } from './parser.types.js'
import type { SourcePatternId } from './pattern-ids.js'
export const patternCues=new Set(['pattern','print','motif','look','نقشة','نقشه','طبعة','طبعه','رسمة','رسومات','بنقشة','بنقشه','imprimé'])
const modelCues=new Set(['brand','model','sku','barcode','ماركة','موديل','كود'])
const foreignCues=new Set(['fabric','material','قماش','خامة','size','مقاس','قياس','color','لون','fit','cut','قصة','collar','neckline','قبة'])
const positive=new Set(['bdi','baddi','بدي','want','veux','need'])
const negatives=new Set(['not','no','مش','مو','ما','بلا','بدون','دون','mish','mesh','mou','ma','dont'])
export function scanPatterns(text:string):readonly ParsedPatternMatch[]{
  const raw=activePatterns.matchTokens(text)
  if(!raw.length)return Object.freeze([])
  const tokens=tokenizeText(text),products=activeProductTypes.matchTokens(text)
  const others=[...activeMaterials.matchTokens(text),...activeColors.matchTokens(text),...scanSourceSizes(text),...activeNecklines.matchTokens(text),...activeFitCuts.matchTokens(text)]
  // A cue already owned by a previous complete phrase (Slim Fit) cannot mark
  // the next independent descriptor (Plain) as a fit attribute.
  const foreignMarked=(start:number)=>foreignCues.has(tokens[start-1])&&!others.some(p=>p.endToken===start&&p.startToken<start-1)
  const span=(r:typeof raw[number])=>({startToken:r.startToken,endToken:r.endToken,text:r.phrase})
  const rows=raw.map(row=>{
    const explicit=patternCues.has(tokens[row.startToken-1])||tokens.slice(row.startToken,row.endToken).some(t=>patternCues.has(t))
    const contains=(p:{startToken:number;endToken:number})=>p.startToken<=row.startToken&&p.endToken>=row.endToken
    const literal=tokens.slice(Math.max(0,row.startToken-3),row.startToken).some((t,offset)=>{
      if(!modelCues.has(t))return false
      const cueIndex=Math.max(0,row.startToken-3)+offset
      return !products.some(p=>p.startToken>cueIndex&&p.endToken<=row.startToken)
        &&!tokens.slice(cueIndex+1,row.startToken).some(t=>patternCues.has(t))
    })
    const owned=[...products,...others].some(p=>contains(p)&&p.endToken-p.startToken>=row.endToken-row.startToken)
    const materialOwned=row.result.crossDomains.some(d=>['materials','sourceMaterials'].includes(d))
    const garment=products.some(p=>!contains(p)&&p.result.candidates.length>0)
    const isPattern=row.result.patterns.length>0
    const role:ParsedPatternMatch['role']=literal?'literal_name':foreignMarked(row.startToken)||(owned||materialOwned)&&!explicit?'owned_by_other':!isPattern?'modifier':explicit||garment||!row.result.crossDomains.length?'descriptor':'requires_context'
    let polarity:ParsedPatternMatch['polarity']='affirmative'
    // Bounded clause scope: a new positive request resets previous negation.
    for(let i=row.startToken-1;i>=Math.max(0,row.startToken-5);i--){if(positive.has(tokens[i])&&!negatives.has(tokens[i-1]))break;if(negatives.has(tokens[i])){polarity='negated';break}}
    return {...span(row),result:row.result,role,polarity,modifierTarget:null as ParsedPatternMatch['modifierTarget'],
      constrainsCatalog:polarity==='affirmative'&&role==='descriptor'}
  })
  for(const row of rows.filter(r=>r.result.modifiers.length&&!r.result.patterns.length)){
    if(foreignMarked(row.startToken))continue
    const target=rows.find(p=>p.role==='descriptor'&&p.polarity===row.polarity&&(p.startToken===row.endToken||p.endToken===row.startToken))
    const explicit=patternCues.has(tokens[row.startToken-1])||tokens.slice(row.startToken,row.endToken).some(t=>patternCues.has(t))
    if(target&&!['literal_name'].includes(row.role)){row.role='modifier';row.modifierTarget={startToken:target.startToken,endToken:target.endToken,text:target.text};row.constrainsCatalog=row.polarity==='affirmative'}
    else if(explicit&&row.role!=='literal_name'){row.role='modifier'}
  }
  return freezePattern(rows)
}
export function patternAttribute(rows:readonly ParsedPatternMatch[]):ParsedAttribute<SourcePatternId>{
  const hits=rows.filter(r=>r.polarity==='affirmative'&&r.role!=='literal_name'&&r.result.patterns.length)
  const ids=[...new Set(hits.flatMap(r=>r.result.patterns))]
  const ambiguous=hits.some(r=>!r.constrainsCatalog||r.result.patterns.length+r.result.modifiers.length!==1)
  // Distinct spans may describe a mixed motif, not necessarily a contradictory garment.
  const status=!hits.length?'missing':ambiguous||ids.length>1?'ambiguous':'resolved'
  return freezePattern({status,value:status==='resolved'?ids[0]:null,candidates:ids,source:status==='resolved'?'explicit':null,
    evidence:hits.map(r=>({span:{text:r.text,startToken:r.startToken,endToken:r.endToken},source:'explicit' as const,rule:'source_pattern_alias'}))})
}
/** Recognized plain/no-print phrases own lexical negation without authorizing a negative request. */
export const isPlainPhrase=(row:ParsedPatternMatch)=>row.polarity==='affirmative'&&row.constrainsCatalog&&row.result.patterns.length===1&&row.result.patterns[0]==='PLAIN_SOLID'&&normalizeText(row.text).split(' ').length>1
