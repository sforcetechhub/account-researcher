import { Actor, log } from 'apify';

import { discoverCandidates } from './discover.js';
import { enrichCandidates } from './enrich.js';
import type { ActorInput } from './types.js';

await Actor.init();

try {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);

    if (!input.companyName || !String(input.companyName).trim()) {
        throw new Error('Input "companyName" is required.');
    }

    input.companyName = String(input.companyName).trim();
    input.maxResults = input.maxResults && input.maxResults > 0 ? Math.min(input.maxResults, 20) : 5;
    if (input.website) input.website = String(input.website).trim();
    if (input.linkedinUrl) input.linkedinUrl = String(input.linkedinUrl).trim();
    if (input.countryCode) input.countryCode = String(input.countryCode).trim().toLowerCase();

    log.info('Starting account research', {
        companyName: input.companyName,
        website: input.website ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        maxResults: input.maxResults,
        countryCode: input.countryCode ?? null,
    });

    const candidates = await discoverCandidates(input);
    log.info(`Discovered ${candidates.length} candidate(s)`);

    if (candidates.length === 0) {
        log.warning('No company candidates found');
        await Actor.pushData({
            companyName: input.companyName,
            legalName: null,
            domain: null,
            website: null,
            description: null,
            industry: null,
            employeeCount: null,
            employeeBand: null,
            foundedYear: null,
            location: {
                city: null,
                region: null,
                country: null,
                fullAddress: null,
                hq: null,
            },
            socials: {
                linkedin: input.linkedinUrl ?? null,
                twitter: null,
                facebook: null,
                instagram: null,
                youtube: null,
            },
            logoUrl: null,
            phone: null,
            matchConfidence: 'low',
            sources: [],
            query: input.companyName,
        });
    } else {
        const records = await enrichCandidates(candidates, input);
        for (const record of records) {
            await Actor.pushData(record);
        }
        log.info(`Pushed ${records.length} company record(s) to the dataset`);
    }
} catch (err) {
    log.exception(err as Error, 'Account research failed');
    throw err;
} finally {
    await Actor.exit();
}
