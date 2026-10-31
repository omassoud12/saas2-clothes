import { createDictionary } from '../dictionary.js'
import type { DictionaryEntry, ContextualAliases, Size } from '../dictionary.types.js'

const numericSizes = ['28', '30', '32', '34', '36', '38', '40'] as const satisfies readonly Size[]
const numericEntries: DictionaryEntry<'sizes'>[] = numericSizes.map(value => ({
  value, aliases: [`size ${value}`, `مقاس ${value}`, `قياس ${value}`, `2iyas ${value}`],
}))
const contextual: ContextualAliases<'sizes'>[] = numericSizes.map(value => ({
  aliases: [value], candidates: [value], reason: 'Bare number may be a size, quantity, code, or price; context is required.',
}))

export const sizes = createDictionary({
  domain: 'sizes',
  entries: [
    { value: 'XS', aliases: ['XS', 'Extra Small', 'إكس سمول'] },
    { value: 'S', aliases: ['S', 'Small', 'سمول'] },
    { value: 'M', aliases: ['M', 'Medium', 'ميديوم'] },
    { value: 'L', aliases: ['L', 'Large', 'لارج'] },
    { value: 'XL', aliases: ['XL', 'Extra Large', 'إكس لارج'] },
    { value: 'XXL', aliases: ['XXL', '2XL', 'Double XL', 'Double Extra Large', 'دبل إكس لارج'] },
    { value: 'XXXL', aliases: ['XXXL', '3XL', 'Triple XL', 'Triple Extra Large', 'تريبل إكس لارج'] },
    ...numericEntries,
  ],
  contextual,
})
