import { Platform } from 'react-native';
import { apiGet, apiPost } from './client';
export interface SponsoredPlacement {
    deliveryId: string;
    creativeId: string;
    afterOrganic: number;
    brand: string;
    mediaKind: 'photo' | 'video';
    caption: string;
    cta: string;
    /** An https link, or null for the View Profile CTA (which opens the advertiser's profile). */
    destination: string | null;
    /** Set for the View Profile CTA. */
    profileUsername?: string | null;
    reportingEnabled: boolean;
    explanation: string;
}
export function getAdPlacements(count: number, token: string): Promise<{
    items: SponsoredPlacement[];
}> {
    // The platform only matters for campaigns aimed at Android or iOS; the server ignores anything else.
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : '';
    return apiGet(`/api/v1/ads/placements?organicCount=${Math.max(0, Math.min(1000, Math.floor(count)))}${platform ? `&platform=${platform}` : ''}`, token);
}
export type AdCtaAction = { kind: 'profile'; username: string } | { kind: 'link'; url: string };
/** What tapping the CTA does: View Profile opens the advertiser's profile; the rest open an https link. Anything else does nothing. */
export function adCtaAction(ad: Pick<SponsoredPlacement, 'cta' | 'destination' | 'profileUsername'>): AdCtaAction | null {
    if (ad.cta === 'View Profile')
        return ad.profileUsername && /^[a-z0-9_.]{3,30}$/i.test(ad.profileUsername) ? { kind: 'profile', username: ad.profileUsername } : null;
    return ad.destination && /^https:\/\/[^\s]+$/i.test(ad.destination) ? { kind: 'link', url: ad.destination } : null;
}
export function validateAd(id: string, token: string): Promise<SponsoredPlacement> { return apiGet(`/api/v1/ads/deliveries/${id}`, token); }
export function reportAd(id: string, reason: string, token: string): Promise<void> { return apiPost(`/api/v1/ads/deliveries/${id}/report`, { reason }, token); }
interface AdEvent {
    deliveryId: string;
    event: string;
    visibleMs: number;
}
const queues = new Map<string, AdEvent[]>();
let scheduled: ReturnType<typeof setTimeout> | null = null;
function flush(): void {
    scheduled = null;
    for (const [token, events] of queues) {
        queues.delete(token);
        void apiPost('/api/v1/ads/events', { events }, token).catch(() => undefined);
    }
}
/** Bounded, best-effort batches. Swiping never awaits analytics or retries. */
export function recordAd(deliveryId: string, event: string, visibleMs: number, token: string): void {
    const batch = queues.get(token) ?? [];
    if (!batch.some(e => e.deliveryId === deliveryId && e.event === event))
        batch.push({ deliveryId, event, visibleMs: Math.min(3600000, Math.max(0, Math.floor(visibleMs))) });
    queues.set(token, batch);
    if (batch.length >= 20 || event === 'ad_hide') {
        if (scheduled)
            clearTimeout(scheduled);
        flush();
    }
    else if (!scheduled)
        scheduled = setTimeout(flush, 250);
}
