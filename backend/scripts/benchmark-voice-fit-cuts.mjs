import fs from 'node:fs'
import {performance} from 'node:perf_hooks'
import {execFileSync} from 'node:child_process'
import {parseVoiceSaleText as after} from '../.test-dist/voice-sales/parser.js'
import {matchParsedCatalog as afterMatch} from '../.test-dist/voice-sales/catalog-matcher.js'
import {parseVoiceSaleText as before} from '../.test-dist/fits-before/voice-sales/parser.js'
import {matchParsedCatalog as beforeMatch} from '../.test-dist/fits-before/voice-sales/catalog-matcher.js'
const row={productId:'p',variantId:'v',productName:'Cedar Tshirt',categoryName:'Tshirt',color:'Black',size:'XL',sellingPrice:'25.00',availableStock:5,currency:'USD'}
const plain={variants:[row],scannedVariants:1,truncated:false},text='Cedar Tshirt black XL two pieces'
const summaries=values=>{values.sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)]}}
for(let i=0;i<40;i++){beforeMatch(before(text),plain);afterMatch(after(text),plain)}
const b=[],a=[]
for(let i=0;i<200;i++) {
  for(const [parse,match,values] of i%2?[[after,afterMatch,a],[before,beforeMatch,b]]:[[before,beforeMatch,b],[after,afterMatch,a]]) {
    const start=performance.now();match(parse(text),plain);values.push(performance.now()-start)
  }
}
const styleText='Cedar jeans wede leg 5ser 3ale black W32/L30 two pieces'
const styleRow={...row,productName:'Cedar jeans wide leg high waist',categoryName:'Jeans',size:'W32/L30'}
const workload=(variants,count)=>{
  const snapshot={variants,scannedVariants:variants.length,truncated:false}
  const p=after(styleText),values=[]
  for(let i=0;i<3;i++)afterMatch(p,snapshot)
  for(let i=0;i<count;i++){const start=performance.now();afterMatch(p,snapshot);values.push(performance.now()-start)}
  return summaries(values)
}
const cold=relative=>{
  const entry=new URL(relative,import.meta.url).href
  return JSON.parse(execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',
    `global.gc();const base=process.memoryUsage();const start=performance.now();await import(${JSON.stringify(entry)});global.gc();console.log(JSON.stringify({startupMs:performance.now()-start,heapDeltaMiB:(process.memoryUsage().heapUsed-base.heapUsed)/1048576,rssMiB:process.memoryUsage().rss/1048576}))`],{encoding:'utf8'}))
}
const result={node:process.version,liveSupabase:false,method:'Same process, alternating paired warm parser+pure matcher on an identical descriptor-free synthetic catalog. Cold subprocesses measure full dictionary imports, not only Fits.',
  warmBefore:summaries(b),warmAfter:summaries(a),shared1000:workload(Array.from({length:1000},(_,i)=>({...styleRow,variantId:`v${i}`})),20),
  distinct1000:workload(Array.from({length:1000},(_,i)=>({...styleRow,productName:`Cedar${i} jeans wide leg high waist`,variantId:`v${i}`})),5),
  coldBefore:cold('../.test-dist/fits-before/voice-sales/index.js'),coldAfter:cold('../.test-dist/voice-sales/index.js'),
  runtimeResourceBytes:['fits-cuts.seed.json','fits-cuts.source-collisions.json'].reduce((n,name)=>n+fs.statSync(new URL(`../resources/voice-sales/${name}`,import.meta.url)).size,0)}
result.warmMeanDeltaMs=result.warmAfter.meanMs-result.warmBefore.meanMs
fs.writeFileSync(new URL('../src/voice-sales/FITS_CUTS_PERFORMANCE.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
