# خطة مشروع: منصة إدارة مخزون ومبيعات الألبسة (SaaS)

## 1. فكرة المشروع

منصة SaaS داخلية (internal) لإدارة مخزون ومبيعات محلات الألبسة، بنظام **multi-tenant**: كل محل (account) مستقل تماماً عن الباقي، مع نظام صلاحيات (roles) داخل كل account.

---

## 2. البنية الهرمية (Hierarchy)

```
Platform
  └── Super Admin — يدير كل الـ accounts على المنصة (تفعيل/تعطيل، مراقبة عامة)
        └── Account (كل محل) — منفصل تماماً عن باقي الحسابات
              ├── Owner — كل الصلاحيات
              └── Warehouse Employee (موظف واحد بس لكل account) — صلاحيات محدودة
```

### صلاحيات كل Role

| القسم | Super Admin | Owner | Warehouse |
|---|---|---|---|
| إدارة كل الـ accounts | ✅ | ❌ | ❌ |
| Products (إضافة/تعديل) | - | ✅ | ✅ |
| Homepage / Categories | - | ✅ | ✅ |
| Business Part (تسعير، مصاريف) | - | ✅ | ❌ |
| Accounting Part | - | ✅ | ❌ |
| رؤية Cost (سعر الجملة) | - | ✅ | ❌ |
| إضافة موظف Warehouse | - | ✅ | ❌ |

---

## 3. الـ Product Template

كل منتج بيحوي:

- **Category** (Pantalon, Chemise... إلخ)
- **صورة المنتج**
- **اللون (Color)**
- **سعر الجملة (Cost)** — الـ Owner فقط يقدر يشوفه/يدخله
- **الكمية المتوفرة (Stock)**
- **سعر البيع (Suggested Price)** — محسوب أوتوماتيك، قابل للتعديل يدوياً وقت البيع

### منطق إضافة منتج جديد

1. **Warehouse** بيضيف منتج (Category, Image, Color, Stock) — **بدون Cost** (السعر بيضل فاضي مؤقتاً)
2. **Owner** بيرجع لاحقاً ويضيف الـ Cost → عندها يتحسب `suggestedPrice` أوتوماتيك
3. **Warehouse** كمان بيقدر يضيف categories جديدة

### Restocking (كمية إضافية)

لو وصلت شحنة جديدة لنفس المنتج (نفس category + color)، **بتزيد على الكمية الموجودة** لنفس المنتج (مش entry جديد)، بس بتنسجل بجدول منفصل (`StockMovement`) لتتبع تاريخ كل شحنة وكلفتها (ممكن تختلف كلفة شحنة عن التانية).

---

## 4. Business Part (قسم التسعير والتحليل)

خاص بالـ Owner فقط. بيحتوي:

1. **إدخال المصاريف العامة** (إيجار، كهربا، رواتب...) — بتنضاف يدوياً كل ما صار مصروف فعلي (مش تسجيل شهري ثابت)
2. **حساب السعر الأوتوماتيكي لكل قطعة**:

```
نصيب القطعة من المصاريف = مجموع المصاريف بالفترة ÷ عدد القطع (مباعة أو موجودة) بنفس الفترة

السعر المقترح = (سعر الجملة + نصيب القطعة من المصاريف) × (1 + نسبة الربح الخاصة بالـ category)
```

3. الحساب بيصير بشكل **دوري** (job يومي/أسبوعي) — مش لحظي بكل مرة، حتى يكون دقيق وما يبطي النظام
4. السعر الناتج هو **سعر مقترح** — البائع فيه يعدّله يدوياً وقت البيع الفعلي (بيتسجل بـ `Sale.soldPrice` لهيك عملية بس، من دون ما يغيّر السعر الافتراضي للمنتج)
5. **دراسة بيانات (Analytics)** — تحليل أداء عام عبر فترات زمنية

---

## 5. الجردة (Reports)

- **يومية وأسبوعية**
- بتحتوي: المخزون + المبيعات + الأسعار (كل شي سوا)
- تتحسب كـ **scheduled aggregation job** (مش live كل مرة) — بتتخزن جاهزة بجدول `DailyReport` حتى تطلع بسرعة

---

## 6. الصور (Images)

| القرار | التفصيل |
|---|---|
| حد أقصى Upload | 5-10 MB لكل صورة |
| Processing | Resize + Compress أوتوماتيك وقت الرفع (مكتبة **Sharp**) |
| الصيغة | WebP (أخف من JPEG بـ 25-35%) |
| النسخ المخزّنة | Thumbnail (~150px) + Display (~800px) — **مش الأصلية** |
| مكان التخزين | Object storage (**Cloudflare R2** أو S3) — مش بالـ database، بس الـ URL يلي بيتخزن |
| تقدير الحجم الكلي | ~150 GB لـ 10,000 seller × 100 منتج (رقم معقول وكلفته زهيدة) |

---

## 7. الـ Stack التقني

| الطبقة | التقنية |
|---|---|
| Frontend | React (Vite) + TypeScript + Tailwind |
| Backend | Node.js + Express/Fastify + TypeScript |
| Database | **PostgreSQL** |
| ORM | Prisma |
| Auth | حل جاهز (Clerk أو Supabase Auth) بدل بناءه من الصفر |
| Image Storage | Cloudflare R2 أو AWS S3 |
| Hosting | Railway / Render (backend + DB)، Vercel (frontend) اختياري |
| Connection Pooling | PgBouncer (مجاني — إما مدمج بالـ managed DB أو self-hosted بلا كلفة إضافية) |

### ليش Postgres مش MongoDB؟

- علاقات واضحة ومحكمة بين الجداول (Seller → Product → Sale)
- Transactions قوية (بيع منتج + نقصان مخزون لازم يصيروا سوا أو ما يصير ولا واحد فيهم — atomic)
- قوي بالـ aggregations (SUM, GROUP BY) اللازمة للتقارير
- يتكامل منيح مع Prisma + TypeScript

---

## 8. Multi-Tenancy (كيف بنفصل بيانات كل Account)

**Shared database, shared schema، بس كل جدول فيه `accountId`.**

- مش database منفصلة لكل seller (overkill لـ 10K accounts)
- كل query بتتفلتر إجبارياً بـ `WHERE accountId = ...` — عن طريق middleware بالـ backend حتى ما ينسى حدا يفلتر (bug خطير لو نسي: seller يشوف بيانات seller تاني)

---

## 9. الـ Database Schema (Prisma) — النسخة النهائية (8 جداول)

```prisma
enum UserRole {
  SUPER_ADMIN
  OWNER
  WAREHOUSE
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  role      UserRole
  accountId String?  // null فقط لـ SUPER_ADMIN
  account   Account? @relation(fields: [accountId], references: [id])
  createdAt DateTime @default(now())
}

model Account {
  id         String        @id @default(cuid())
  name       String
  isActive   Boolean       @default(true)
  users      User[]
  categories Category[]
  products   Product[]
  expenses   Expense[]
  sales      Sale[]
  reports    DailyReport[]
  createdAt  DateTime      @default(now())
}

model Category {
  id        String    @id @default(cuid())
  accountId String
  account   Account   @relation(fields: [accountId], references: [id])
  name      String    // "Pantalon", "Chemise"...
  products  Product[]
  createdAt DateTime  @default(now())

  @@index([accountId])
}

model Product {
  id             String          @id @default(cuid())
  accountId      String
  account        Account         @relation(fields: [accountId], references: [id])
  categoryId     String
  category       Category        @relation(fields: [categoryId], references: [id])
  name           String
  imageUrl       String
  color          String
  wholesaleCost  Float?          // null لحد ما Owner يحطها — فقط Owner بيشوفها
  profitMargin   Float?          // null لحد ما Owner يحطها — فقط Owner بيشوفها
  currentStock   Int             @default(0)
  suggestedPrice Float?          // محسوب أوتوماتيك من cost + margin + مصاريف موزعة
  createdById    String
  createdAt      DateTime        @default(now())
  sales          Sale[]
  movements      StockMovement[]

  @@index([accountId])
  @@index([accountId, categoryId])
}

model StockMovement {
  id         String   @id @default(cuid())
  productId  String
  product    Product  @relation(fields: [productId], references: [id])
  quantity   Int
  costAtTime Float?
  addedById  String
  createdAt  DateTime @default(now())

  @@index([productId])
}

model Expense {
  id          String   @id @default(cuid())
  accountId   String
  account     Account  @relation(fields: [accountId], references: [id])
  description String
  amount      Float
  date        DateTime @default(now())

  @@index([accountId])
}

model Sale {
  id         String   @id @default(cuid())
  accountId  String
  account    Account  @relation(fields: [accountId], references: [id])
  productId  String
  product    Product  @relation(fields: [productId], references: [id])
  categoryId String   // نسخة من فئة المنتج وقت البيع (لفلترة سريعة + دقة تاريخية)
  quantity   Int
  soldPrice  Float    // السعر الفعلي يلي انباعت فيه (ممكن يختلف عن suggestedPrice)
  costAtSale Float    // كلفة القطعة وقت البيع (snapshot ثابت لا يتغير لاحقاً)
  soldById   String
  createdAt  DateTime @default(now())

  @@index([accountId, createdAt])
  @@index([accountId, categoryId, createdAt])
  @@index([accountId, productId, createdAt])
}

model DailyReport {
  id             String   @id @default(cuid())
  accountId      String
  account        Account  @relation(fields: [accountId], references: [id])
  date           DateTime
  totalSales     Float
  totalProfit    Float
  totalUnitsSold Int
  stockValue     Float
  createdAt      DateTime @default(now())

  @@unique([accountId, date])
  @@index([accountId, date])
}
```

### شرح وظيفة كل جدول

| # | الجدول | النوع | الدور |
|---|---|---|---|
| 1 | `Account` | جذر | كل محل — كل شي تاني بيرجع إلو |
| 2 | `User` | حالة | المستخدمين (Super Admin, Owner, Warehouse) |
| 3 | `Category` | حالة | تصنيف بسيط (اسم فقط، بدون profitMargin) |
| 4 | `Product` | حالة | المنتج الحالي (cost + margin + stock + سعر مقترح) |
| 5 | `StockMovement` | سجل تاريخي (append-only) | كل شحنة بضاعة وصلت، بكميتها وكلفتها وتاريخها |
| 6 | `Expense` | سجل تاريخي (append-only) | كل مصروف عام، أساس حساب توزيع المصاريف على القطع |
| 7 | `Sale` | سجل تاريخي (append-only) | **المصدر الحقيقي** لكل بيع — بيحوي snapshot للكلفة والفئة وقت البيع |
| 8 | `DailyReport` | ملخص محسوب مسبقاً (cache) | إجمالي جاهز باليوم، محسوب من `Sale` بواسطة job دوري |

### لماذا snapshot الحقول (`costAtSale`, `categoryId` بـ Sale)؟

لو المنتج تغيّرت كلفته أو تصنيفه لاحقاً، المبيعات القديمة يجب أن تبقى بأرقامها التاريخية الصحيحة كما كانت وقت حدوثها — لا تتأثر بتعديلات لاحقة على `Product`. لهذا يتم نسخ (snapshot) هذه القيم داخل `Sale` نفسه بدل الاعتماد على قراءتها من `Product` كل مرة.

### استراتيجية الـ Analytics (دراسة المبيعات المفلترة)

| الحاجة | المصدر |
|---|---|
| إجمالي عام سريع بدون فلترة (Dashboard الرئيسي) | `DailyReport` — جاهز، لا يحتاج حساب لحظي |
| فلترة حسب Category / Product / نطاق تاريخ (شهري، سنوي، دراسة مبيعات) | `Sale` مباشرة — مع الـ indexes المركّبة `(accountId, categoryId, createdAt)` و`(accountId, productId, createdAt)` لأداء سريع حتى مع ملايين الصفوف |

الربح الحقيقي بأي تحليل يُحسب دائماً من: `SUM((soldPrice - costAtSale) × quantity)` — وليس من `suggestedPrice`.

---

## 10. اعتبارات الأداء (Scale)

### هل 10,000 مستخدم مشكلة؟

- **10,000 users مسجلين** ≠ **10,000 requests بنفس الثانية** — الفرق جوهري
- بما إنه نظام داخلي (مش app عام بترافيك عشوائي)، الاستخدام موزّع عبر ساعات الدوام، مش كله بلحظة وحدة
- التقدير الواقعي: عشرات إلى مية RPS بالـ peak، مش آلاف

### هل 5 مليون منتج (10K account × 500 منتج) مشكلة لـ Postgres/Supabase؟

- **لأ إطلاقاً** — Postgres بيتحمل بسهولة عشرات وحتى مئات الملايين من الصفوف
- الشرط الوحيد: **Indexing صحيح** (موجود أعلاه بالـ schema) + **pagination** بكل query بترجع ليستة
- من ناحية الحجم بالـ GB: البيانات النصية/الرقمية (بدون صور) رح تضل تحت 1-2 GB — أقل بكتير من حدود أي plan مدفوع بـ Supabase

### مبدأ عام تم اعتماده: تجنب الـ Premature Optimization

- ما نبني من اليوم الأول لسيناريوهات ضخمة نظرية (متعددة السيرفرات، Redis، إلخ)
- نبلش ببنية بسيطة تشتغل صح (server واحد + Postgres + connection pooling بسيط)
- نضيف تحسينات (caching، horizontal scaling) بس لما تصير مشكلة أداء حقيقية وملموسة

---

## 11. Migrations — كيف بتطبّق الـ Schema عملياً

- كل تغيير على الـ `schema.prisma` بينحوّل لملف SQL موثّق (`prisma/migrations/...`) عن طريق:
  ```bash
  npx prisma migrate dev --name وصف_التغيير   # محلياً فقط، وقت التطوير
  ```
- على الإنتاج، بيتطبّق نفس الـ migrations الموجودة والموثّقة مسبقاً (بدون توليد جديدة):
  ```bash
  npx prisma migrate deploy
  ```
- **مهم:** `migrate dev` لا يُستخدم أبداً على الإنتاج — فقط `migrate deploy`، لتفادي أي فقدان بيانات غير مقصود.
- كل تغيير هدّام (حذف عمود فيه بيانات) بيعطي تحذير واضح من Prisma قبل التنفيذ — لازم backup قبل أي تغيير من هالنوع على الإنتاج.

---

## 12. الخطوات القادمة (Next Steps)

1. تجهيز الـ project structure (backend + frontend)
2. تطبيق الـ Prisma schema فعلياً وعمل أول migration
3. بناء نظام الـ Auth + Roles
4. بناء أول feature: إضافة منتج (Warehouse flow)
5. بناء منطق حساب السعر الأوتوماتيكي
6. بناء صفحة تسجيل البيع ونقصان المخزون
7. بناء الجردة اليومية/الأسبوعية
