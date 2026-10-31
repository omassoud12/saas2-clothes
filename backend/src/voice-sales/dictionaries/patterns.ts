import { createDictionary } from '../dictionary.js'

export const patterns = createDictionary({
  domain: 'patterns',
  entries: [
    { value: 'PLAIN', aliases: ['Plain', 'سادة', 'Sede', 'Sada'] },
    { value: 'STRIPED', aliases: ['Striped', 'مخطط', 'Mkhatat'] },
    { value: 'CHECKERED', aliases: ['Checkered', 'Checked', 'مربعات', 'Mrabba3at'] },
    { value: 'WAVY', aliases: ['Wavy Pattern', 'نقشة مموجة'] },
  ],
  contextual: [{ aliases: ['Wavy', 'مموج', 'Mmawwaj'], candidates: ['WAVY'], reason: 'May describe a pattern, texture, or garment shape.' }],
})
