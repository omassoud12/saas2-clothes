# SaaS2 Colors & Shades — Source QA Audit

## Verdict

**Suitable as a source vocabulary kit, NOT safe for blind import as trusted one-to-one mappings.** The CSV is an unverified seed; CodeX must audit the runtime normalizer, existing Colors dictionary, parser and catalog matcher.

| Metric | Observed |
|---|---:|
| Color concept IDs | 307 |
| Alias records (including repeated spellings) | 3,475 |
| Unique CSV normalized keys | 2,937 |
| Cross-color collisions (CSV `normalized`) | 64 |
| Raw cross-color alias collision keys | 63 |
| Repeated raw alias records within same color | 306 |
| Repeated normalized alias records within same color | 470 |
| `exact_candidate` records | 3,314 |
| `needs_context` records | 161 |
| `seed_review` records | 3,042 |
| `needs_review` records | 433 |

## High-impact semantic collisions

- **خمري**: BORDEAUX, BURGUNDY, MAROON_RED, WINE_RED.
- **سكري**: CREAM, OFF_WHITE.
- **kaki**: KHAKI_BEIGE, KHAKI_GREEN.
- **bone**: BONE_WHITE, BROWN.
- **فوشي**: FUCHSIA, MAGENTA.
- **أسود فاحم**: BLACK, JET_BLACK.

See `data/colors.source-collisions.json` for the complete source-normalized collision list. **This is not a claim about the actual SaaS2 backend runtime normalizer; Codex must recompute that result.**

## Cross-domain collisions (requires audit in actual project)

- `جينز` used as a color alias for DENIM_BLUE, but also represents a PRODUCT TYPE and MATERIAL.
- `اسود ساده` / `أسود سادة` includes a PATTERN word; don't erase an explicitly requested pattern constraint.
- COFFEE, BONE, ROSE, MARINE, NUDE and other context-dependent words may also be ordinary product/model words.
- `NO_COLOR`, `MULTICOLOR`, `ASSORTED_COLORS`, `COLORBLOCK`, `GRADIENT`, `OMBRE` may need a separate color-mode interpretation rather than an ordinary single solid-color constraint.

## Important source gaps

`كحلية` and `زيتية` are NOT literal aliases in this CSV, although `كحلي`, `زيتي`, `k7li`, and `zayti` exist. Existing dictionary may support them. Don't remove trusted old aliases, and don't falsely claim imported coverage for absent words.

## Preserve data provenance and QA policy

- Preserve every original CSV record and its provenance fields; never treat `sourceNormalized` as the runtime lookup key without re-normalizing.
- `generated_definite_ar` and `needs_review` entries require conservative review before trusting. User permission to activate is not proof that an alias is unambiguous.
- A source row marked `exact_candidate` is **not** proof of uniqueness across all domains; re-check collisions against the runtime normalization and current dictionary.
- Normalize both spoken color and stored ProductVariant.color through same compatible system. Preserve stored labels; don't rewrite merchant data.
- No database migration or inventory mutation. Use actual current selling price/stock and require confirmation before POS Cart changes.

## Testing

- Validate that all 3,475 records round-trip correctly and all 307 IDs remain stable.
- Exercise aliases, collisions, cross-domain words, multiword phrase precedence, mixed languages, gendered colors, unknown words, size 32 and quantity 32.
- Test hard cases: a uniquely correct catalog color; multiple color possibilities; and catalogs where **both** possible shades exist.
- Compare to existing trusted dictionary; add rather than replace/erase previous names.
- This QA is **CSV-only**; no backend code or real Supabase tenant catalog was available for verification here.
