import { createDictionary } from '../dictionary.js'

export const productTypes = createDictionary({
  domain: 'productTypes',
  entries: [
    { value: 'T_SHIRT', aliases: ['T-Shirt', 'Tshirt', 'Tchirt', 't chirt', 'تي شيرت', 'تيشيرت'] },
    { value: 'JEANS', aliases: ['Jeans', 'جينز', 'بنطلون جينز'] },
    { value: 'PANTS', aliases: ['Pants', 'Trousers', 'بنطلون', 'Bantalon'] },
    { value: 'BODYSUIT', aliases: ['Bodysuit', 'Body suit', 'بودي', 'Boudi'] },
    { value: 'SWEATER', aliases: ['Sweater', 'Pullover', 'كنزة صوف'] },
    { value: 'DRESS', aliases: ['Dress', 'فستان', 'Fostan'] },
    { value: 'LEGGINGS', aliases: ['Leggings', 'ليغينغ', 'Legging'] },
    { value: 'TIGHTS', aliases: ['Tights', 'جوارب طويلة', 'Collant'] },
    { value: 'UNDERWEAR', aliases: ['Underwear', 'كيلوت', 'Kilout'] },
    { value: 'BRA', aliases: ['Bra', 'سوتيان', 'Soutien'] },
    { value: 'HOODIE', aliases: ['Hoodie', 'هودي', 'Houdi'] },
    { value: 'JACKET', aliases: ['Jacket', 'جاكيت', 'Jaket'] },
    { value: 'SHIRT', aliases: ['Shirt', 'قميص', 'شيميز', '2amis', 'Qamis'] },
    { value: 'TOP', aliases: ['Top', 'بلوزة', 'Blouze'] },
    { value: 'POLO_SHIRT', aliases: ['Polo Shirt', 'قميص بولو'] },
  ],
  contextual: [
    { aliases: ['Body'], candidates: ['BODYSUIT'], reason: 'Body may mean a bodysuit or a non-garment body reference.' },
    { aliases: ['كنزة', 'Kenza'], candidates: ['SWEATER', 'TOP'], reason: 'Lebanese Kenza may mean a sweater or a general top.' },
    { aliases: ['كولون', 'Kolon'], candidates: ['LEGGINGS', 'TIGHTS'], reason: 'Local usage varies between leggings and tights.' },
    { aliases: ['Polo', 'بولو'], candidates: ['POLO_SHIRT'], reason: 'Polo may identify a shirt or only its collar.' },
  ],
  suggestions: [{ aliases: ['جينس'], candidates: ['JEANS'], reason: 'Possible transcription mistake; requires confirmation.' }],
})
