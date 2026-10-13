import { parse as parseDomain } from 'tldts';

import type {
    CompanyCandidate,
    CompanyLocation,
    CompanyRecord,
    CompanySocials,
    MatchConfidence,
} from './types.js';

/** Domains that are directories / aggregators — not company websites. */
export const EXCLUDED_DOMAINS = new Set([
    'linkedin.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'youtube.com',
    'youtu.be',
    'crunchbase.com',
    'bloomberg.com',
    'wikipedia.org',
    'zoominfo.com',
    'rocketreach.co',
    'apollo.io',
    'clearbit.com',
    'glassdoor.com',
    'indeed.com',
    'yelp.com',
    'yellowpages.com',
    'bbb.org',
    'dnb.com',
    'owler.com',
    'pitchbook.com',
    'cbinsights.com',
    'craft.co',
    'tracxn.com',
    'builtin.com',
    'wellfound.com',
    'angel.co',
    'github.com',
    'medium.com',
    'reddit.com',
    'quora.com',
    'forbes.com',
    'techcrunch.com',
    'businessinsider.com',
    'reuters.com',
    'nytimes.com',
    'amazon.com',
    'google.com',
    'bing.com',
    'duckduckgo.com',
    'yahoo.com',
    'apple.com',
    'play.google.com',
    'apps.apple.com',
    'maps.google.com',
    'g2.com',
    'capterra.com',
    'trustpilot.com',
    'clutch.co',
    'sourceforge.net',
    'producthunt.com',
]);

export function emptyLocation(): CompanyLocation {
    return {
        city: null,
        region: null,
        country: null,
        fullAddress: null,
        hq: null,
    };
}

export function emptySocials(): CompanySocials {
    return {
        linkedin: null,
        twitter: null,
        facebook: null,
        instagram: null,
        youtube: null,
    };
}

export function ensureUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

export function extractDomain(urlOrHost: string | null | undefined): string | null {
    if (!urlOrHost) return null;
    const withProtocol = ensureUrl(urlOrHost);
    if (!withProtocol) return null;

    try {
        const parsed = parseDomain(withProtocol);
        if (!parsed.domain) return null;
        return parsed.domain.toLowerCase();
    } catch {
        return null;
    }
}

export function isExcludedDomain(domain: string | null | undefined): boolean {
    if (!domain) return true;
    const lower = domain.toLowerCase();
    if (EXCLUDED_DOMAINS.has(lower)) return true;
    for (const excluded of EXCLUDED_DOMAINS) {
        if (lower.endsWith(`.${excluded}`)) return true;
    }
    return false;
}

export function canonicalizeWebsite(urlOrHost: string | null | undefined): string | null {
    const domain = extractDomain(urlOrHost);
    if (!domain || isExcludedDomain(domain)) return null;
    return `https://${domain}`;
}

export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(ensureUrl(url)!);
        if (!u.hostname.includes('linkedin.com')) return null;
        const match = u.pathname.match(/\/company\/([^/?#]+)/i);
        if (!match) return ensureUrl(url);
        return `https://www.linkedin.com/company/${match[1].replace(/\/$/, '')}`;
    } catch {
        return null;
    }
}

export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|bv|pty)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function nameSimilarity(a: string, b: string): number {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.85;

    const tokensA = new Set(na.split(' ').filter(Boolean));
    const tokensB = new Set(nb.split(' ').filter(Boolean));
    let overlap = 0;
    for (const t of tokensA) {
        if (tokensB.has(t)) overlap += 1;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union === 0 ? 0 : overlap / union;
}

export function domainLooksLikeCompanyName(domain: string, companyName: string): boolean {
    const base = domain.split('.')[0] ?? '';
    const name = normalizeName(companyName).replace(/\s+/g, '');
    const domainNorm = base.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!name || !domainNorm) return false;
    return domainNorm.includes(name.slice(0, Math.min(6, name.length)))
        || name.includes(domainNorm.slice(0, Math.min(6, domainNorm.length)));
}

export function parseLocationFromAddress(address: unknown): CompanyLocation {
    const loc = emptyLocation();
    if (!address) return loc;

    if (typeof address === 'string') {
        loc.fullAddress = address.trim() || null;
        loc.hq = loc.fullAddress;
        const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
            loc.city = parts[parts.length - 3] ?? null;
            loc.region = parts[parts.length - 2] ?? null;
            loc.country = parts[parts.length - 1] ?? null;
        } else if (parts.length === 2) {
            loc.city = parts[0] ?? null;
            loc.country = parts[1] ?? null;
        } else if (parts.length === 1) {
            loc.country = parts[0] ?? null;
        }
        return loc;
    }

    if (typeof address === 'object' && address !== null) {
        const a = address as Record<string, unknown>;
        loc.city = (a.addressLocality as string) || (a.city as string) || null;
        loc.region = (a.addressRegion as string) || (a.region as string) || (a.state as string) || null;
        loc.country = (a.addressCountry as string) || (a.country as string) || null;
        if (typeof loc.country === 'object' && loc.country !== null) {
            const c = loc.country as { name?: string };
            loc.country = c.name ?? null;
        }
        const street = (a.streetAddress as string) || null;
        const postal = (a.postalCode as string) || null;
        const pieces = [street, loc.city, loc.region, postal, loc.country].filter(Boolean);
        loc.fullAddress = pieces.length ? pieces.join(', ') : null;
        loc.hq = [loc.city, loc.region, loc.country].filter(Boolean).join(', ') || loc.fullAddress;
    }

    return loc;
}

export function employeeBandFromCount(count: number | null): string | null {
    if (count == null || Number.isNaN(count)) return null;
    if (count <= 10) return '1-10';
    if (count <= 50) return '11-50';
    if (count <= 200) return '51-200';
    if (count <= 500) return '201-500';
    if (count <= 1000) return '501-1000';
    if (count <= 5000) return '1001-5000';
    if (count <= 10000) return '5001-10000';
    return '10001+';
}

export function parseEmployeeCount(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
        const digits = value.replace(/,/g, '').match(/\d+/);
        return digits ? Number(digits[0]) : null;
    }
    if (typeof value === 'object') {
        const v = value as Record<string, unknown>;
        if (v.value != null) return parseEmployeeCount(v.value);
        if (v.minValue != null && v.maxValue != null) {
            const min = parseEmployeeCount(v.minValue);
            const max = parseEmployeeCount(v.maxValue);
            if (min != null && max != null) return Math.round((min + max) / 2);
        }
    }
    return null;
}

export function parseFoundedYear(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number' && value > 1800 && value < 2100) return Math.round(value);
    if (typeof value === 'string') {
        const match = value.match(/(18|19|20)\d{2}/);
        return match ? Number(match[0]) : null;
    }
    return null;
}

export function classifySocialUrl(url: string): keyof CompanySocials | null {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        if (host.includes('linkedin.com')) return 'linkedin';
        if (host.includes('twitter.com') || host === 'x.com') return 'twitter';
        if (host.includes('facebook.com') || host.includes('fb.com')) return 'facebook';
        if (host.includes('instagram.com')) return 'instagram';
        if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    } catch {
        return null;
    }
    return null;
}

export function mergeSocials(...parts: Array<Partial<CompanySocials> | null | undefined>): CompanySocials {
    const out = emptySocials();
    for (const part of parts) {
        if (!part) continue;
        for (const key of Object.keys(out) as Array<keyof CompanySocials>) {
            if (!out[key] && part[key]) out[key] = part[key]!;
        }
    }
    return out;
}

export function scoreMatchConfidence(candidate: CompanyCandidate, queryName: string, hasWebsiteInput: boolean): MatchConfidence {
    if (hasWebsiteInput) return 'high';
    if (candidate.linkedinUrl && candidate.domain) return 'high';

    const sim = nameSimilarity(candidate.name || candidate.title || '', queryName);
    const domainMatch = candidate.domain ? domainLooksLikeCompanyName(candidate.domain, queryName) : false;

    if (sim >= 0.85 && (domainMatch || candidate.domain)) return 'high';
    if (sim >= 0.5 || domainMatch) return 'medium';
    return 'low';
}

export function dedupeCandidates(candidates: CompanyCandidate[]): CompanyCandidate[] {
    const byDomain = new Map<string, CompanyCandidate>();
    const withoutDomain: CompanyCandidate[] = [];

    for (const c of candidates) {
        if (!c.domain) {
            withoutDomain.push(c);
            continue;
        }
        const existing = byDomain.get(c.domain);
        if (!existing) {
            byDomain.set(c.domain, { ...c, sources: [...c.sources] });
            continue;
        }
        existing.sources = [...new Set([...existing.sources, ...c.sources])];
        if (!existing.linkedinUrl && c.linkedinUrl) existing.linkedinUrl = c.linkedinUrl;
        if (!existing.website && c.website) existing.website = c.website;
        if ((c.searchRank ?? 999) < (existing.searchRank ?? 999)) {
            existing.searchRank = c.searchRank;
            existing.title = c.title ?? existing.title;
            existing.snippet = c.snippet ?? existing.snippet;
        }
    }

    return [...byDomain.values(), ...withoutDomain];
}

export function emptyCompanyRecord(query: string): CompanyRecord {
    return {
        companyName: query,
        legalName: null,
        domain: null,
        website: null,
        description: null,
        industry: null,
        employeeCount: null,
        employeeBand: null,
        foundedYear: null,
        location: emptyLocation(),
        socials: emptySocials(),
        logoUrl: null,
        phone: null,
        matchConfidence: 'low',
        sources: [],
        query,
    };
}
