import { Actor, log } from 'apify';

import {
    canonicalizeWebsite,
    dedupeCandidates,
    extractDomain,
    isExcludedDomain,
    nameSimilarity,
    normalizeLinkedInUrl,
} from './normalize.js';
import type {
    ActorInput,
    CompanyCandidate,
    GoogleOrganicResult,
    GoogleSearchResultItem,
} from './types.js';

const GOOGLE_SEARCH_ACTOR = 'apify/google-search-scraper';

function buildSearchQueries(companyName: string, linkedinUrl?: string): string[] {
    const queries = [
        `"${companyName}" official website`,
        `${companyName} company`,
    ];
    if (linkedinUrl) {
        queries.push(`${companyName} site:linkedin.com/company`);
    }
    return queries;
}

function resultToCandidate(
    result: GoogleOrganicResult,
    companyName: string,
    rank: number,
): CompanyCandidate | null {
    const url = result.url;
    if (!url) return null;

    const linkedin = normalizeLinkedInUrl(url);
    if (linkedin) {
        return {
            name: companyName,
            domain: null,
            website: null,
            linkedinUrl: linkedin,
            title: result.title ?? null,
            snippet: result.description ?? null,
            searchRank: rank,
            sources: [url],
        };
    }

    const domain = extractDomain(url);
    if (!domain || isExcludedDomain(domain)) return null;

    const website = canonicalizeWebsite(url);
    const title = result.title ?? '';
    const sim = nameSimilarity(title, companyName);

    // Prefer results whose title resembles the company; still keep plausible corporate domains.
    if (sim < 0.2 && rank > 5) return null;

    return {
        name: companyName,
        domain,
        website,
        linkedinUrl: null,
        title: result.title ?? null,
        snippet: result.description ?? null,
        searchRank: rank,
        sources: [url],
    };
}

async function runGoogleSearch(
    queries: string[],
    maxPagesPerQuery: number,
    countryCode?: string,
): Promise<GoogleOrganicResult[]> {
    const runInput: Record<string, unknown> = {
        queries,
        maxPagesPerQuery,
        resultsPerPage: 10,
        mobileResults: false,
    };
    if (countryCode) {
        runInput.countryCode = countryCode.toLowerCase();
    }

    log.info(`Calling ${GOOGLE_SEARCH_ACTOR}`, { queries, countryCode });

    try {
        const run = await Actor.call(GOOGLE_SEARCH_ACTOR, runInput, {
            waitSecs: 120,
        });

        if (!run?.defaultDatasetId) {
            log.warning('Google Search actor returned no dataset');
            return [];
        }

        const { items } = await Actor.apifyClient
            .dataset(run.defaultDatasetId)
            .listItems({ limit: 100 });

        const organic: GoogleOrganicResult[] = [];
        for (const item of items as GoogleSearchResultItem[]) {
            if (Array.isArray(item.organicResults)) {
                organic.push(...item.organicResults);
            }
        }
        return organic;
    } catch (err) {
        log.warning(`Google Search actor failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}

/**
 * Fallback discovery when Google Search actor is unavailable (e.g. local without token).
 * Uses DuckDuckGo HTML results via a simple fetch — best-effort only.
 */
async function fallbackDuckDuckGoSearch(companyName: string): Promise<GoogleOrganicResult[]> {
    const query = encodeURIComponent(`${companyName} official website`);
    const url = `https://html.duckduckgo.com/html/?q=${query}`;

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AccountResearcher/1.0)',
            },
        });
        if (!res.ok) return [];
        const html = await res.text();
        const results: GoogleOrganicResult[] = [];

        // DuckDuckGo HTML uses result__a links and result__snippet.
        const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match: RegExpExecArray | null;
        while ((match = linkRe.exec(html)) !== null && results.length < 15) {
            let href = match[1];
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            // DDG sometimes wraps redirects: //duckduckgo.com/l/?uddg=<encoded>
            try {
                const u = new URL(href, 'https://duckduckgo.com');
                const uddg = u.searchParams.get('uddg');
                if (uddg) href = decodeURIComponent(uddg);
            } catch {
                // keep href
            }
            results.push({ url: href, title, description: '' });
        }
        return results;
    } catch (err) {
        log.warning(`DuckDuckGo fallback failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}

function rankCandidates(candidates: CompanyCandidate[], companyName: string): CompanyCandidate[] {
    return [...candidates].sort((a, b) => {
        const score = (c: CompanyCandidate) => {
            let s = 0;
            if (c.domain) s += 3;
            if (c.website) s += 2;
            if (c.linkedinUrl) s += 1;
            s += nameSimilarity(c.title || c.name, companyName) * 5;
            s -= (c.searchRank ?? 50) * 0.1;
            return s;
        };
        return score(b) - score(a);
    });
}

/**
 * Build candidate companies from input seeds and/or web search.
 */
export async function discoverCandidates(input: ActorInput): Promise<CompanyCandidate[]> {
    const {
        companyName,
        website,
        linkedinUrl,
        maxResults = 5,
        countryCode,
    } = input;

    const seeded: CompanyCandidate[] = [];

    if (website) {
        const domain = extractDomain(website);
        const canonical = canonicalizeWebsite(website);
        if (domain && !isExcludedDomain(domain) && canonical) {
            seeded.push({
                name: companyName,
                domain,
                website: canonical,
                linkedinUrl: normalizeLinkedInUrl(linkedinUrl) ?? null,
                sources: [canonical, linkedinUrl].filter(Boolean) as string[],
                searchRank: 0,
            });
        }
    }

    // Website provided → single candidate path (still allow LinkedIn seed merge).
    if (seeded.length > 0) {
        return seeded.slice(0, 1);
    }

    const linkedin = normalizeLinkedInUrl(linkedinUrl);
    if (linkedin) {
        seeded.push({
            name: companyName,
            domain: null,
            website: null,
            linkedinUrl: linkedin,
            sources: [linkedin],
            searchRank: 0,
        });
    }

    const queries = buildSearchQueries(companyName, linkedin ?? undefined);
    let organic = await runGoogleSearch(queries, 1, countryCode);

    if (organic.length === 0) {
        log.info('Falling back to DuckDuckGo HTML search');
        organic = await fallbackDuckDuckGoSearch(companyName);
    }

    const fromSearch: CompanyCandidate[] = [];
    organic.forEach((result, index) => {
        const candidate = resultToCandidate(result, companyName, index + 1);
        if (candidate) fromSearch.push(candidate);
    });

    // Merge LinkedIn-only seeds with domain candidates that share the run.
    const merged = dedupeCandidates([...seeded, ...fromSearch]);

    // Attach LinkedIn URL from search hits onto domain candidates when possible.
    const linkedInHits = merged.filter((c) => c.linkedinUrl && !c.domain);
    const domainHits = merged.filter((c) => c.domain);
    for (const d of domainHits) {
        if (d.linkedinUrl) continue;
        const li = linkedInHits[0];
        if (li?.linkedinUrl) {
            d.linkedinUrl = li.linkedinUrl;
            d.sources = [...new Set([...d.sources, ...li.sources])];
        }
    }

    // Prefer domain-backed companies; keep LinkedIn-only if nothing else found.
    const preferred = domainHits.length > 0 ? domainHits : merged;
    const ranked = rankCandidates(preferred, companyName);

    return ranked.slice(0, Math.max(1, maxResults));
}
