# Account Researcher

Apify Actor that researches companies from a **name** (plus optional **website** / **LinkedIn**) and returns structured account profiles: domain, socials, location, and firmographics.

When only a name is provided, the Actor searches the web for matching companies. If several plausible matches are found, **each match is pushed as a separate dataset item**.

## Input

| Field | Required | Description |
|-------|----------|-------------|
| `companyName` | yes | Company name to research |
| `website` | no | Website or domain — skips discovery and enriches this company |
| `linkedinUrl` | no | LinkedIn company URL used as a seed / corroboration signal |
| `maxResults` | no | Max matches when searching by name (default `5`) |
| `countryCode` | no | Two-letter country code to bias search (e.g. `us`, `in`) |

### Example

```json
{
  "companyName": "Apify",
  "maxResults": 5
}
```

```json
{
  "companyName": "Apify",
  "website": "https://apify.com",
  "linkedinUrl": "https://www.linkedin.com/company/apify/"
}
```

## Output

One dataset item per company, including:

- `companyName`, `legalName`, `domain`, `website`
- `description`, `industry`, `employeeCount`, `employeeBand`, `foundedYear`
- `location` — `{ city, region, country, fullAddress, hq }`
- `socials` — `{ linkedin, twitter, facebook, instagram, youtube }`
- `logoUrl`, `phone`
- `matchConfidence` — `high` | `medium` | `low`
- `sources`, `query`

Missing fields are `null` (nothing is invented).

## How it works

1. **Discover** — If `website` is set, use that domain. Otherwise call Apify’s Google Search scraper (`apify/google-search-scraper`) with queries like `"{name}" official website`. Falls back to DuckDuckGo HTML search when the Google actor is unavailable (e.g. local runs without tokens).
2. **Filter & rank** — Drop directory sites (LinkedIn, Crunchbase, Wikipedia, etc.), dedupe by domain, rank by name similarity, take top `maxResults`.
3. **Enrich** — Crawl each candidate homepage (and About page when linked) with Crawlee Cheerio. Parse schema.org JSON-LD, meta/OG tags, addresses, and social links.

## Local development

```bash
npm install
```

Create input at `storage/key_value_stores/default/INPUT.json`:

```json
{
  "companyName": "Apify",
  "website": "https://apify.com"
}
```

Run:

```bash
npm start
```

Or with the Apify CLI:

```bash
npx apify-cli run
```

Build for production image:

```bash
npm run build
```

## Deploy

```bash
npx apify-cli login
npx apify-cli push
```

On the Apify platform, ensure the run can call `apify/google-search-scraper` (same account / permissions). Proxy is used automatically when available.
