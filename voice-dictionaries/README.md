# Voice sale dictionaries

The original dictionary packages (integration kits) that the voice sale matcher was built from,
one folder per topic, in the order the parser uses them. The packages stay on this computer
(they are large and not committed); only this README is in git. What the app actually uses is
the imported copy in `backend/resources/voice-sales/`.

| Folder | Package | Imported as |
|---|---|---|
| `01-product-types` | SAAS2_Product_Types_Integration_Kit | `product-types.*.json` |
| `02-colors` | SAAS2_Colors_Dictionary_Complete, SAAS2_Colors_Dictionary_Integration_Kit | `colors.*` |
| `03-sizes` | SAAS2_Sizes_Dictionary_Integration_Kit | `sizes.*` |
| `04-quantities` | SAAS2_Quantities_Dictionary_Integration_Kit | `quantities.*` |
| `05-materials-fabrics` | SAAS2_Materials_Fabrics_Dictionary_Integration_Kit | `materials.*` |
| `06-patterns-prints` | SAAS2_Patterns_Prints_Dictionary_Integration_Kit | `patterns.*` |
| `07-fits-cuts` | SAAS2_Fits_Cuts_Dictionary_Integration_Kit | `fits-cuts.*` |
| `08-necklines-collars` | SAAS2_Necklines_Collars_Dictionary_Integration_Kit | `necklines.*` |
| `09-common-expressions` | SAAS2_Common_Expressions_Dictionary_Integration_Kit | `common-expressions.*` |

The `.zip` next to a folder is the original download. The audit scripts in `backend/scripts/audit-voice-*.mjs`
read the packages from these folders.
