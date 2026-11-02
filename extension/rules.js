export const LEASE_MS = 15_000;

export function effectiveState(input, now = Date.now()) {
  if (input === null) return { active: false, domains: [], endsAt: null, updatedAt: now };
  if (
    !input ||
    input.version !== 1 ||
    typeof input.active !== 'boolean' ||
    !Array.isArray(input.domains) ||
    input.domains.length > 500 ||
    !Number.isSafeInteger(input.updatedAt) ||
    input.updatedAt < 0 ||
    input.updatedAt > now ||
    !(input.endsAt === null || (Number.isSafeInteger(input.endsAt) && input.endsAt > 0)) ||
    (input.active && input.endsAt === null) ||
    input.domains.some(
      domain =>
        typeof domain !== 'string' ||
        domain.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain) ||
        domain.split('.').some(label => label.length > 63) ||
        /^\d+$/.test(domain.split('.').at(-1)),
    )
  ) {
    throw new Error('Unhook supplied an invalid browser state.');
  }
  const active = input.active && input.endsAt > now && now - input.updatedAt <= LEASE_MS;
  return { ...input, active, domains: active ? [...new Set(input.domains)] : [] };
}

export function blockedDomain(url, state) {
  if (!state.active) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return state.domains.find(domain => host === domain || host === `www.${domain}`) ?? null;
  } catch {
    return null;
  }
}

export function blockedPageUrl(pageUrl, domain) {
  return `${pageUrl}?site=${encodeURIComponent(domain)}`;
}

export function makeRules(state, pageUrl) {
  if (!state.active) return [];
  return state.domains.flatMap((domain, index) => {
    const regexFilter = `^https?://(www\\.)?${domain.replace(/\./g, '\\.')}\\.?(:[0-9]+)?/`;
    return [
      {
        id: index * 2 + 1,
        priority: 2,
        action: { type: 'redirect', redirect: { url: blockedPageUrl(pageUrl, domain) } },
        condition: { regexFilter, resourceTypes: ['main_frame'] },
      },
      {
        id: index * 2 + 2,
        priority: 1,
        action: { type: 'block' },
        condition: { regexFilter, excludedResourceTypes: ['main_frame'] },
      },
    ];
  });
}
