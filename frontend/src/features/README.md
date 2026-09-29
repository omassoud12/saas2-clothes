# Frontend feature ownership

Feature components, React-free domain flows and their colocated tests live together:

| Folder | Owns |
| --- | --- |
| `products/` | Product creation, catalog confirmation, colors/options, product requests, setup, images and quick-stock recovery |
| `sales/` | Cart/checkout flows and sale lifecycle panel for returns, exchanges and voids |
| `inventory/` | Restock dialog/workflow, movement history and reconciliation |
| `categories/` | Category validation, requests and mutation helpers |
| `finance/` | Expense/report requests, business dates and report validation |
| `dashboard/` | Dashboard loading and summary composition |

Route entry components remain in `pages/app/`; they compose feature modules.
Application routing, protected shell and navigation/dirty-state infrastructure
remain in `app/`. Session and authentication entry flows remain in `auth/`.
Shared transport, Supabase client and exact money helpers remain in `lib/`;
domain-free UI remains in `components/`.

Import a feature module directly rather than through a barrel. Cross-feature
domain imports are allowed where needed (for example POS reads the product
catalog), but features should not depend on route pages. Shared UI must not
know product, inventory or sale business rules.

Products CSS moved with its feature; its import still originates from the
Products route to preserve stylesheet loading and the existing cascade. Other
feature styles remain in global CSS pending a separate visual-parity refactor.

`adjustVariantStock` replaces `quickAddStock`: the operation supports both +1
and -1. `applyVariantPrices` replaces `applyVariantPrice`: it applies a price
to selected variants. These are internal frontend names; backend endpoints,
payloads and idempotency/storage keys are unchanged.

This organization change does not decompose page controllers, alter auth
contracts, or fix the behavioral findings in earlier audits. Those remain
separate changes requiring their own regression coverage.
