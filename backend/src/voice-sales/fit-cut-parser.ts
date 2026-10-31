import { activeFitCuts, activeProductTypes, activeColors, activeMaterials, activeNecklines, tokenizeText } from './index.js'
import { scanSourceSizes } from './size-parser.js'
import { fitCutConcept, freezeFitCut } from './fit-cut-source.js'
import { fitCutIdsByAxis } from './fit-cut-ids.js'
import type { FitCutAxis, FitCutIdForAxis } from './fit-cut-ids.js'
import type { FitCutAttributes, ParsedFitCutMatch } from './fit-cut.types.js'
import type { ParsedAttribute } from './parser.types.js'

export const fitCutCues = new Set(['fit','cut','style','coupe','قصة','قصه','قصّة','ستايل','2assa'])
const modelCues=new Set(['brand','model','sku','barcode','ماركة','موديل','كود'])
const positiveRequest=new Set(['bdi','baddi','بدي','want','veux','need'])
const negatives=new Set(['not','no','مش','مو','ما','بلا','بدون','mish','mesh','mou','ma','dont'])
export function scanFitCuts(text:string):readonly ParsedFitCutMatch[] {
  const raw=activeFitCuts.matchTokens(text)
  if (!raw.length) return Object.freeze([])
  const tokens=tokenizeText(text), products=activeProductTypes.matchTokens(text)
  const other=[...activeColors.matchTokens(text),...scanSourceSizes(text),...activeMaterials.matchTokens(text),...activeNecklines.matchTokens(text)]
  const span=(row:typeof raw[number])=>({startToken:row.startToken,endToken:row.endToken,text:row.phrase})
  return freezeFitCut(raw.map(row=>{
    const domainExplicit=fitCutCues.has(tokens[row.startToken-1]) || tokens.slice(row.startToken,row.endToken).some(t=>fitCutCues.has(t))
    const literal=tokens.slice(Math.max(0,row.startToken-3),row.startToken).some(t=>modelCues.has(t))
    const contains=(p:{startToken:number;endToken:number})=>p.startToken<=row.startToken&&p.endToken>=row.endToken
    // A longer exact product/material/neckline/size phrase owns its entire span.
    const owned=products.some(p=>contains(p)&&p.endToken-p.startToken>=row.endToken-row.startToken)
      || other.some(p=>contains(p)&&p.endToken-p.startToken>=row.endToken-row.startToken)
    const garment=products.some(p=>!contains(p)&&p.result.candidates.length>0)
    const foreign=row.result.crossDomains.some(d=>!['sourceProductTypes','fits'].includes(d))
    const isStyle=row.result.styles.length>0
    const role:ParsedFitCutMatch['role']=literal?'literal_name':owned&&!fitCutCues.has(tokens[row.startToken-1])?'owned_by_other':!isStyle?'modifier'
      :domainExplicit || garment || !foreign?'descriptor':'requires_context'
    let polarity:ParsedFitCutMatch['polarity']='affirmative'
    for (let i=row.startToken-1;i>=Math.max(0,row.startToken-4);i--) {
      if (positiveRequest.has(tokens[i]) && !negatives.has(tokens[i-1])) break
      if (negatives.has(tokens[i])) {polarity='negated';break}
    }
    const target=!isStyle?raw.find(s=>s.result.styles.length>0 && (s.startToken===row.endToken || s.endToken===row.startToken)):undefined
    return {...span(row),result:row.result,role,polarity,modifierTarget:target?span(target):null,
      constrainsCatalog:polarity==='affirmative' && (role==='descriptor' || role==='modifier' && !!target)}
  }))
}

/** Per-axis alternatives remain typed; a phrase crossing axes never proves both. */
export function fitCutAttributes(rows:readonly ParsedFitCutMatch[]):FitCutAttributes {
  function axis<A extends FitCutAxis>(key:A):ParsedAttribute<FitCutIdForAxis<A>> {
    const hits=rows.filter(r=>r.polarity==='affirmative'&&r.role!=='literal_name'
      && r.result.styles.some(id=>fitCutConcept(id).group===key))
    const ids=[...new Set(hits.flatMap(r=>r.result.styles.filter(id=>fitCutConcept(id).group===key)))] as FitCutIdForAxis<A>[]
    const definite=hits.filter(r=>r.constrainsCatalog&&r.result.styles.length+r.result.modifiers.length===1)
    const conflict=new Set(definite.flatMap(r=>r.result.styles)).size>1
    const ambiguous=hits.some(r=>!r.constrainsCatalog||r.result.styles.length+r.result.modifiers.length!==1)
    const status=!hits.length?'missing':conflict?'conflict':ambiguous?'ambiguous':'resolved'
    return freezeFitCut({status,value:status==='resolved'?ids[0]:null,candidates:ids,
      source:status==='resolved'?'explicit':null,evidence:hits.map(row=>({span:{text:row.text,startToken:row.startToken,endToken:row.endToken},source:'explicit' as const,rule:`source_fit_cut:${key}`}))})
  }
  return freezeFitCut(Object.fromEntries((Object.keys(fitCutIdsByAxis) as FitCutAxis[]).map(key=>[key,axis(key)])) as FitCutAttributes)
}
