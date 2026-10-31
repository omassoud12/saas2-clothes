import { createDictionary } from '../dictionary.js'

export const materials = createDictionary({
  domain: 'materials',
  entries: [
    { value: 'VELVET', aliases: ['Velvet', 'مخمل', 'Makhmal'] },
    { value: 'COTTON', aliases: ['Cotton', 'قطن', '2oton'] },
    { value: 'DENIM', aliases: ['Denim', 'جينز'] },
    { value: 'WOOL', aliases: ['Wool', 'صوف', 'Souf'] },
    { value: 'LINEN', aliases: ['Linen', 'كتان', 'Kettan'] },
    { value: 'LEATHER', aliases: ['Leather', 'جلد', 'Jeld'] },
  ],
})
