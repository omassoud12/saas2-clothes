import { createDictionary } from '../dictionary.js'

export const fits = createDictionary({
  domain: 'fits',
  entries: [
    { value: 'SLIM_FIT', aliases: ['Slim Fit', 'عالجسم', 'ضيق', '3al jesem', 'Dayye2'] },
    { value: 'REGULAR_FIT', aliases: ['Regular Fit', 'عادي', '3ade'] },
    { value: 'OVERSIZED', aliases: ['Oversized', 'Oversize', 'أوفر سايز', 'Over size'] },
    { value: 'LOOSE_FIT', aliases: ['Loose Fit', 'واسع', 'Wese3'] },
  ],
})
