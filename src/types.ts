export interface ActorInput {
    companyName: string;
    website?: string;
    linkedinUrl?: string;
    maxResults?: number;
    countryCode?: string;
}

export interface CompanyLocation {
    city: string | null;
    region: string | null;
    country: string | null;
    fullAddress: string | null;
    hq: string | null;
}

export interface CompanySocials {
    linkedin: string | null;
    twitter: string | null;
    facebook: string | null;
    instagram: string | null;
    youtube: string | null;
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface CompanyRecord {
    companyName: string;
    legalName: string | null;
    domain: string | null;
    website: string | null;
    description: string | null;
    industry: string | null;
    employeeCount: number | null;
    employeeBand: string | null;
    foundedYear: number | null;
    location: CompanyLocation;
    socials: CompanySocials;
    logoUrl: string | null;
    phone: string | null;
    matchConfidence: MatchConfidence;
    sources: string[];
    query: string;
}

export interface CompanyCandidate {
    name: string;
    domain: string | null;
    website: string | null;
    linkedinUrl: string | null;
    title?: string | null;
    snippet?: string | null;
    searchRank?: number;
    sources: string[];
}

export interface GoogleOrganicResult {
    title?: string;
    url?: string;
    description?: string;
    displayedUrl?: string;
}

export interface GoogleSearchResultItem {
    searchQuery?: { term?: string };
    organicResults?: GoogleOrganicResult[];
}
