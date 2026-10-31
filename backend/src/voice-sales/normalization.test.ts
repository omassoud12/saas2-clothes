import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeText, tokenizeText } from './normalization.js'

describe('voice-sales text normalization', () => {
  for (const [input, expected] of [
    ['  SawDA\t BLACK\n', 'sawda black'],
    ['أسود إكس آبي ٱبيض', 'اسود اكس ابي ابيض'],
    ['سُـودَا قُبّة مَبْرُومة', 'سودا قبة مبرومة'],
    ['على ی ک', 'علي ي ك'],
    ['Size ٣٢ / ۳۲ / 32', 'size 32 32 32'],
    ['ＸＸＬ ３２', 'xxl 32'],
    ['ﻻ', 'لا'],
    ['  بَدّي T-Shirt سودا، SIZE ٣٢  ', 'بدي t shirt سودا size 32'],
    ['2oton Ka7le 3al jesem', '2oton ka7le 3al jesem'],
    ['\u200FBLACK\u200E \u202AXL\u202C', 'black xl'],
    ['XL/XXL, XXXL', 'xl xxl xxxl'],
    ['قبة قبه', 'قبة قبه'],
    ['cafe\u0301', 'café'],
    ['\u200BXL\u200BXXL', 'xl xxl'],
    ['تيشيرتpolo poloتيشيرت', 'تيشيرت polo polo تيشيرت'],
    ['model32 ka7le', 'model32 ka7le'],
    ['', ''],
  ]) {
    test(`normalizes ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeText(input), expected)
      assert.equal(normalizeText(expected), expected, 'normalization is idempotent')
    })
  }
  test('tokenizes whole words without substring matches', () => {
    assert.deepEqual(tokenizeText('XL XXL XXXL extra-large'), ['xl', 'xxl', 'xxxl', 'extra', 'large'])
    assert.deepEqual(tokenizeText('   '), [])
    assert.ok(Object.isFrozen(tokenizeText('hello')))
  })
})
