# SaaS2 website

Landing page, About and Contact for SaaS2. React 18 + Vite + React Router. Mobile first.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production files in dist/
```

## Pages

| Route      | File                    |
|------------|-------------------------|
| `/`        | `src/pages/Home.jsx`    |
| `/about`   | `src/pages/About.jsx`   |
| `/contact` | `src/pages/Contact.jsx` |

The navbar links Product, Business types, Features and Hardware scroll to sections on `/`.

## Before going live

1. Replace the placeholders in `src/data.js` (`contact`): WhatsApp number and link, email, city, hours, price, founding year.
2. Connect the contact form: `handleSubmit` in `src/pages/Contact.jsx` has a TODO for your API.
3. Colors and fonts are CSS variables at the top of `src/styles.css`.

## SEO notes

- Each page sets its own `<title>` and meta description (`src/useSeo.js`).
- `index.html` has Open Graph tags and `SoftwareApplication` structured data.
- This is a client-rendered app. For the best Google results, pre-render the three routes at build time (for example with `vite-plugin-ssg`/`vite-react-ssg`) or host it as a static site with prerendering, and add a `sitemap.xml` and `robots.txt` in `public/`.
- When you host it on your server, make all routes serve `index.html` (SPA fallback) so `/about` and `/contact` work on refresh.
