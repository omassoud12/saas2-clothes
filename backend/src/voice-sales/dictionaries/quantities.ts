import { createDictionary } from '../dictionary.js'
import type { DictionaryEntry, Quantity } from '../dictionary.types.js'

const words: readonly (readonly [Quantity, readonly string[]])[] = [
  [1, ['One', 'واحد', 'قطعة', 'Wa7ad']],
  // Explicit requested spelling of قطعتين; the Arabizi 3 is not a quantity.
  [2, ['Two', 'اتنين', 'إثنين', 'قطعتين', 'Tnen', 'kt3ten']],
  [3, ['Three', 'تلاتة', 'ثلاث قطع', 'Tlete']],
  [4, ['Four', 'أربعة', 'أربع قطع', 'Arba3a']],
  [5, ['Five', 'خمسة', 'خمس قطع', '5amse']],
  [6, ['Six', 'ستة', 'ست قطع', 'Sette']],
  [7, ['Seven', 'سبعة', 'سبع قطع', 'Sab3a']],
  [8, ['Eight', 'تمانية', 'ثمانية', 'Tmenye']],
  [9, ['Nine', 'تسعة', 'Tes3a']],
  [10, ['Ten', 'عشرة', '3ashra']],
  [12, ['Twelve', 'اتناش', 'Tna3sh']],
  [20, ['Twenty', 'عشرين', '3eshreen']],
  [24, ['Twenty Four', 'أربع وعشرين قطعة']],
  [30, ['Thirty', 'ثلاثين', 'Tleteen']],
  [32, ['Thirty Two', 'اتنين وتلاتين قطعة']],
  [50, ['Fifty', 'خمسين', '5amseen']],
  [100, ['One Hundred', 'مية', 'Miyye']],
]
const entries: DictionaryEntry<'quantities'>[] = words.map(([value, aliases]) => ({
  value,
  aliases: [...aliases, `${value} ${value === 1 ? 'piece' : 'pieces'}`, `${value} قطعة`,
    ...(value >= 2 && value <= 10 ? [`${value} قطع`] : [])],
}))

export const quantities = createDictionary({ domain: 'quantities', entries })
