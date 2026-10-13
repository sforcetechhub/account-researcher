import { Actor, log } from 'apify';
import { CheerioCrawler, type ProxyConfiguration } from 'crawlee';

import {
    canonicalizeWebsite,
    classifySocialUrl,
    emptyCompanyRecord,
    emptyLocation,
    employeeBandFromCount,
    ensureUrl,
    extractDomain,
    mergeSocials,
    normalizeLinkedInUrl,
    parseEmployeeCount,
    parseFoundedYear,
    parseLocationFromAddress,
    scoreMatchConfidence,
} from './normalize.js';
import type {
    ActorInput,
    CompanyCandidate,
    CompanyLocation,
    CompanyRecord,
    CompanySocials,
} from './types.js';

interface PageExtract {
    companyName: string | null;
    legalName: string | null;
    description: string | null;
    industry: string | null;
    employeeCount: number | null;
    foundedYear: number | null;
    location: CompanyLocation;
    socials: CompanySocials;
    logoUrl: string | null;
    phone: string | null;
    aboutUrl: string | null;
    website: string | null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function pickString(...values: unknown[]): string | null {
    for (const v of values) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

// Use a loose cheerio-like type to avoid CJS/ESM CheerioAPI conflicts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioLike = (selector: any) => {
    each: (fn: (i: number, el: any) => void) => unknown;
    first: () => {
        text: () => string;
        attr: (name: string) => string | undefined;
        length: number;
    };
    attr: (name: string) => string | undefined;
    text: () => string;
    contents: () => { text: () => string };
    length: number;
};

function parseJsonLd($: CheerioLike): Record<string, unknown>[] {
    const nodes: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === 'object') nodes.push(item as Record<string, unknown>);
                }
            } else if (parsed && typeof parsed === 'object') {
                const obj = parsed as Record<string, unknown>;
                if (Array.isArray(obj['@graph'])) {
                    for (const item of obj['@graph']) {
                        if (item && typeof item === 'object') nodes.push(item as Record<string, unknown>);
                    }
                } else {
                    nodes.push(obj);
                }
            }
        } catch {
            // ignore invalid JSON-LD
        }
    });
    return nodes;
}

function isOrgType(typeValue: unknown): boolean {
    const types = asArray(typeValue).map((t) => String(t).toLowerCase());
    return types.some((t) =>
        t.includes('organization')
        || t.includes('corporation')
        || t.includes('localbusiness')
        || t.includes('company'),
    );
}

function extractSocialsFromHtml($: CheerioLike): CompanySocials {
    const socials: CompanySocials = {
        linkedin: null,
        twitter: null,
        facebook: null,
        instagram: null,
        youtube: null,
    };

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const abs = ensureUrl(href);
        if (!abs) return;
        const key = classifySocialUrl(abs);
        if (key && !socials[key]) {
            socials[key] = key === 'linkedin' ? normalizeLinkedInUrl(abs) : abs;
        }
    });

    return socials;
}

function findAboutUrl($: CheerioLike, baseUrl: string): string | null {
    const patterns = [/about/i, /company/i, /who-we-are/i, /our-story/i];
    let found: string | null = null;

    $('a[href]').each((_, el) => {
        if (found) return;
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (!href) return;
        if (!patterns.some((p) => p.test(href) || p.test(text))) return;
        try {
            found = new URL(href, baseUrl).toString();
        } catch {
            // ignore
        }
    });

    return found;
}

function extractFromPage($: CheerioLike, pageUrl: string): PageExtract {
    const jsonLd = parseJsonLd($);
    const org = jsonLd.find((n) => isOrgType(n['@type'])) ?? null;

    let companyName: string | null = null;
    let legalName: string | null = null;
    let description: string | null = null;
    let industry: string | null = null;
    let employeeCount: number | null = null;
    let foundedYear: number | null = null;
    let location = emptyLocation();
    let logoUrl: string | null = null;
    let phone: string | null = null;
    let website: string | null = canonicalizeWebsite(pageUrl);

    if (org) {
        companyName = pickString(org.name);
        legalName = pickString(org.legalName);
        description = pickString(org.description);
        industry = pickString(org.industry, org.naics, org.knowsAbout);
        employeeCount = parseEmployeeCount(org.numberOfEmployees);
        foundedYear = parseFoundedYear(org.foundingDate);
        location = parseLocationFromAddress(org.address ?? org.location);
        phone = pickString(org.telephone);
        if (org.url) website = canonicalizeWebsite(String(org.url)) ?? website;

        const logo = org.logo;
        if (typeof logo === 'string') logoUrl = logo;
        else if (logo && typeof logo === 'object' && 'url' in (logo as object)) {
            logoUrl = pickString((logo as { url?: string }).url);
        }
    }

    // Meta / Open Graph fallbacks
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || null;
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim() || null;
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() || null;
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;
    const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim() || null;
    const title = $('title').first().text().trim() || null;

    companyName = companyName || ogSite || ogTitle || title;
    // Strip common title suffixes: "Acme | Home"
    if (companyName && /[|–—-]/.test(companyName)) {
        companyName = companyName.split(/[|–—-]/)[0]?.trim() || companyName;
    }
    description = description || ogDesc || metaDesc;
    logoUrl = logoUrl || ogImage;

    // Address hints from footer / contact blocks when JSON-LD lacked address
    if (!location.fullAddress && !location.city) {
        const addressEl = $('[itemprop="address"], address').first();
        if (addressEl.length) {
            location = parseLocationFromAddress(addressEl.text().replace(/\s+/g, ' ').trim());
        }
    }

    if (!phone) {
        const tel = $('a[href^="tel:"]').first().attr('href');
        if (tel) phone = tel.replace(/^tel:/i, '').trim();
    }

    const socials = extractSocialsFromHtml($);
    const aboutUrl = findAboutUrl($, pageUrl);

    return {
        companyName,
        legalName,
        description: description ? description.slice(0, 1000) : null,
        industry: industry ? String(industry).slice(0, 200) : null,
        employeeCount,
        foundedYear,
        location,
        socials,
        logoUrl,
        phone,
        aboutUrl,
        website,
    };
}

function mergeExtracts(base: PageExtract, extra: PageExtract): PageExtract {
    return {
        companyName: base.companyName || extra.companyName,
        legalName: base.legalName || extra.legalName,
        description: base.description || extra.description,
        industry: base.industry || extra.industry,
        employeeCount: base.employeeCount ?? extra.employeeCount,
        foundedYear: base.foundedYear ?? extra.foundedYear,
        location: {
            city: base.location.city || extra.location.city,
            region: base.location.region || extra.location.region,
            country: base.location.country || extra.location.country,
            fullAddress: base.location.fullAddress || extra.location.fullAddress,
            hq: base.location.hq || extra.location.hq,
        },
        socials: mergeSocials(base.socials, extra.socials),
        logoUrl: base.logoUrl || extra.logoUrl,
        phone: base.phone || extra.phone,
        aboutUrl: base.aboutUrl || extra.aboutUrl,
        website: base.website || extra.website,
    };
}

async function crawlCandidatePages(
    startUrls: string[],
    proxyConfiguration?: ProxyConfiguration,
): Promise<{ extracts: Map<string, PageExtract>; visited: string[] }> {
    const extracts = new Map<string, PageExtract>();
    const visited: string[] = [];
    const aboutQueued = new Set<string>();

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: Math.min(startUrls.length * 2 + 2, 20),
        maxConcurrency: 3,
        requestHandlerTimeoutSecs: 45,
        async requestHandler({ $, request, enqueueLinks }) {
            visited.push(request.loadedUrl || request.url);
            const extracted = extractFromPage($ as unknown as CheerioLike, request.loadedUrl || request.url);
            const key = request.userData?.candidateKey as string;
            const existing = extracts.get(key);
            extracts.set(key, existing ? mergeExtracts(existing, extracted) : extracted);

            // Follow one about page per candidate
            if (
                request.userData?.pageType === 'home'
                && extracted.aboutUrl
                && !aboutQueued.has(key)
            ) {
                aboutQueued.add(key);
                await enqueueLinks({
                    urls: [extracted.aboutUrl],
                    userData: { candidateKey: key, pageType: 'about' },
                    forefront: true,
                });
            }
        },
        failedRequestHandler({ request }, error) {
            log.warning(`Request failed ${request.url}: ${error.message}`);
        },
    });

    await crawler.run(
        startUrls.map((url, index) => ({
            url,
            userData: { candidateKey: `c${index}`, pageType: 'home' },
        })),
    );

    return { extracts, visited };
}

function buildRecord(
    candidate: CompanyCandidate,
    extract: PageExtract | undefined,
    input: ActorInput,
    sources: string[],
): CompanyRecord {
    const record = emptyCompanyRecord(input.companyName);
    const hasWebsiteInput = Boolean(input.website);

    record.companyName = extract?.companyName || candidate.name || input.companyName;
    record.legalName = extract?.legalName ?? null;
    record.domain = candidate.domain || extractDomain(extract?.website) || null;
    record.website = candidate.website || extract?.website || canonicalizeWebsite(candidate.domain);
    record.description = extract?.description ?? candidate.snippet ?? null;
    record.industry = extract?.industry ?? null;
    record.employeeCount = extract?.employeeCount ?? null;
    record.employeeBand = employeeBandFromCount(record.employeeCount);
    record.foundedYear = extract?.foundedYear ?? null;
    record.location = extract?.location ?? emptyLocation();
    record.socials = mergeSocials(
        extract?.socials,
        { linkedin: candidate.linkedinUrl || input.linkedinUrl || null },
    );
    if (record.socials.linkedin) {
        record.socials.linkedin = normalizeLinkedInUrl(record.socials.linkedin);
    }
    record.logoUrl = extract?.logoUrl ?? null;
    record.phone = extract?.phone ?? null;
    record.matchConfidence = scoreMatchConfidence(candidate, input.companyName, hasWebsiteInput);
    record.sources = [...new Set(sources.filter(Boolean))];
    record.query = input.companyName;

    return record;
}

/**
 * Enrich candidates by crawling their websites; soft-fail per candidate.
 */
export async function enrichCandidates(
    candidates: CompanyCandidate[],
    input: ActorInput,
): Promise<CompanyRecord[]> {
    const proxyConfiguration = (process.env.APIFY_PROXY_PASSWORD || process.env.APIFY_TOKEN)
        ? await Actor.createProxyConfiguration().catch(() => undefined)
        : undefined;

    const crawlTargets: { candidate: CompanyCandidate; index: number; url: string }[] = [];
    candidates.forEach((candidate, index) => {
        const url = candidate.website || (candidate.domain ? `https://${candidate.domain}` : null);
        if (url) crawlTargets.push({ candidate, index, url });
    });

    let extracts = new Map<string, PageExtract>();
    let visited: string[] = [];

    if (crawlTargets.length > 0) {
        try {
            const result = await crawlCandidatePages(
                crawlTargets.map((t) => t.url),
                proxyConfiguration,
            );
            extracts = result.extracts;
            visited = result.visited;
        } catch (err) {
            log.warning(`Enrichment crawl failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const records: CompanyRecord[] = [];

    candidates.forEach((candidate, index) => {
        try {
            const crawlIndex = crawlTargets.findIndex((t) => t.index === index);
            const pageExtract = crawlIndex >= 0 ? extracts.get(`c${crawlIndex}`) : undefined;

            const sources = [
                ...candidate.sources,
                ...(pageExtract?.website ? [pageExtract.website] : []),
                ...visited.filter((u) => {
                    const d = extractDomain(u);
                    return d && d === candidate.domain;
                }),
            ];

            records.push(buildRecord(candidate, pageExtract, input, sources));
        } catch (err) {
            log.warning(
                `Failed to build record for ${candidate.domain || candidate.name}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            records.push(buildRecord(candidate, undefined, input, candidate.sources));
        }
    });

    return records;
}
