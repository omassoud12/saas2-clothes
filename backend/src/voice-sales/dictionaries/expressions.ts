import { createDictionary } from '../dictionary.js'

/** Lexical expressions are NOT executable sale commands. */
export const expressions = createDictionary({
  domain: 'expressions',
  entries: [
    { value: 'SALE', aliases: ['Sell', 'بيّع', 'Bi3'] },
    { value: 'WANT', aliases: ['I want', 'بدي', 'Baddi', 'Bdi'] },
    { value: 'SIZE_MARKER', aliases: ['Size', 'مقاس', 'قياس', 'قياسه', 'قياسها', 'وقياسه', 'وقياسها', '2iyas'] },
    { value: 'COLOR_MARKER', aliases: ['Color', 'Colour', 'لون', 'لونه', 'لونها', 'ولونه', 'ولونها', 'Lawn'] },
    { value: 'QUANTITY_MARKER', aliases: ['Quantity', 'عدد', 'كمية', '3adad'] },
    { value: 'PLEASE', aliases: ['Please', 'لو سمحت', 'Law sama7et'] },
    { value: 'CONFIRM', aliases: ['Confirm', 'أكيد', 'Akid'] },
    { value: 'CANCEL', aliases: ['Cancel', 'إلغاء', 'ألغي', 'Elghe'] },
  ],
})
