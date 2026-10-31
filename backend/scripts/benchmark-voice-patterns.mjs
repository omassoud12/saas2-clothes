import fs from 'node:fs'
import {performance} from 'node:perf_hooks'
import {parseVoiceSaleText as after} from '../.test-dist/voice-sales/parser.js'
import {matchParsedCatalog as afterMatch} from '../.test-dist/voice-sales/catalog-matcher.js'
import {parseVoiceSaleText as before} from '../.test-dist/patterns-before/voice-sales/parser.js'
import {matchParsedCatalog as beforeMatch} from '../.test-dist/patterns-before/voice-sales/catalog-matcher.js'
const row={productId:'p',variantId:'v',productName:'Cedar Tshirt',categoryName:'Tshirt',color:'Black',size:'XL',sellingPrice:'25.00',availableStock:5,currency:'USD'},plain={variants:[row],scannedVariants:1,truncated:false},text='Cedar Tshirt black XL two pieces'
const summaries=values=>{values.sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)]}}
for(let i=0;i<30;i++){beforeMatch(before(text),plain);afterMatch(after(text),plain)}
const b=[],a=[];for(let i=0;i<150;i++)for(const [parse,match,values]of i%2?[[after,afterMatch,a],[before,beforeMatch,b]]:[[before,beforeMatch,b],[after,afterMatch,a]]){const start=performance.now();match(parse(text),plain);values.push(performance.now()-start)}
const patternText='Cedar dress ليوبارد black XL two pieces',patternRow={...row,productName:'Cedar dress leopard print',categoryName:'Dress'}
const workload=(distinct,count)=>{const snapshot={variants:Array.from({length:1000},(_,i)=>({...patternRow,variantId:`v${i}`,productName:distinct?`Cedar${i} dress leopard print`:patternRow.productName})),scannedVariants:1000,truncated:false},p=after(patternText),values=[];for(let i=0;i<count;i++){const start=performance.now();afterMatch(p,snapshot);values.push(performance.now()-start)}return summaries(values)}
const result={node:process.version,liveSupabase:'UNVERIFIED',method:'Alternating paired warm parser and pure matcher on identical synthetic data; distinct/shared catalog scenarios have no paired before measurement. No network or database.',
 warmBefore:summaries(b),warmAfter:summaries(a),shared1000:workload(false,10),distinct1000:workload(true,3),
 runtimeResourceBytes:['patterns.seed.json','patterns.source-collisions.json'].reduce((n,name)=>n+fs.statSync(new URL(`../resources/voice-sales/${name}`,import.meta.url)).size,0),
 mockBefore:beforeMatch(before(patternText),{variants:[patternRow],scannedVariants:1,truncated:false}).status,mockAfter:afterMatch(after(patternText),{variants:[patternRow],scannedVariants:1,truncated:false}).status}
result.warmMeanDeltaMs=result.warmAfter.meanMs-result.warmBefore.meanMs
fs.writeFileSync(new URL('../src/voice-sales/PATTERNS_PERFORMANCE.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
