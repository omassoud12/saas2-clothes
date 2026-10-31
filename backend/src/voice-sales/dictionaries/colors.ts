import { createDictionary } from '../dictionary.js'

export const colors = createDictionary({
  domain: 'colors',
  entries: [
    { value: 'BLACK', aliases: ['Black', 'سودا', 'سوداء', 'أسود', 'Sawda', 'Aswad'] },
    { value: 'WHITE', aliases: ['White', 'بيضا', 'بيضاء', 'أبيض', 'Bayda', 'Abyad'] },
    { value: 'NAVY_BLUE', aliases: ['Navy Blue', 'Navy', 'كحلي', 'كحلية', 'Kahle', 'Ka7le'] },
    { value: 'OLIVE_GREEN', aliases: ['Olive Green', 'Olive', 'زيتي', 'زيتية', 'Zayte', 'Zeyte'] },
    { value: 'GREEN', aliases: ['Green', 'أخضر', 'خضرا', 'خضراء', 'Khadra', 'A5dar'] },
    { value: 'RED', aliases: ['Red', 'أحمر', 'حمرا', 'حمراء', 'Hamra', '7amra'] },
    { value: 'BLUE', aliases: ['Blue', 'أزرق', 'زرقا', 'زرقاء', 'Azra2', 'Zar2a'] },
    { value: 'GREY', aliases: ['Grey', 'Gray', 'رمادي', 'رصاصي', 'Ramade', 'Rsase'] },
    { value: 'BEIGE', aliases: ['Beige', 'بيج', 'Bej'] },
    { value: 'BROWN', aliases: ['Brown', 'بني', 'Benne'] },
    { value: 'PINK', aliases: ['Pink', 'زهري', 'Zahre'] },
    { value: 'YELLOW', aliases: ['Yellow', 'أصفر', 'Asfar'] },
    { value: 'ORANGE', aliases: ['Orange', 'برتقالي', 'برتقالية'] },
  ],
  suggestions: [{ aliases: ['soda'], candidates: ['BLACK'], reason: 'Possible Sawda transcription; soda has another meaning.' }],
})
