import { createDictionary } from '../dictionary.js'

export const necklines = createDictionary({
  domain: 'necklines',
  entries: [
    { value: 'POLO_COLLAR', aliases: ['Polo Collar', 'قبّة Polo', 'قبة بولو', '2abbet Polo'] },
    { value: 'CREW_NECK', aliases: ['Crew Neck', 'قبّة مبرومة', '2abbe mabroume'] },
    { value: 'V_NECK', aliases: ['V-Neck', 'قبّة V', 'قبة في', '2abbet V'] },
  ],
  contextual: [{ aliases: ['Polo', 'بولو'], candidates: ['POLO_COLLAR'], reason: 'Polo may identify a collar or a polo shirt.' }],
})
