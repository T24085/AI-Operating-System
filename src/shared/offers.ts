import { OfferSchema, type Offer } from "./schemas.js";

export const offers: Offer[] = [
  {
    id: "dev-starter", business: "Samuel.Studio.dev", name: "Starter Website", category: "website",
    priceType: "starting_at", price: 499, currency: "USD",
    inclusions: ["1–3 pages", "Mobile-friendly design", "Contact form", "Basic SEO setup", "Calls to action"],
    exclusions: ["Booking system", "E-commerce", "Custom application features"],
    purchaseUrl: "https://www.paypal.com/ncp/payment/TS4B6ND3JD9RQ", sourceUrl: "https://dev.samuel.studio/#pricing", reviewedAt: "2026-07-14", active: true,
  },
  {
    id: "dev-professional", business: "Samuel.Studio.dev", name: "Professional Website", category: "website",
    priceType: "starting_at", price: 999, currency: "USD",
    inclusions: ["4–7 pages", "Custom homepage", "Service pages", "About page", "Basic SEO and analytics", "Responsive design"],
    exclusions: ["Booking system", "E-commerce", "Custom application features"],
    purchaseUrl: "https://www.paypal.com/ncp/payment/776NMJ97LJZ2Q", sourceUrl: "https://dev.samuel.studio/#pricing", reviewedAt: "2026-07-14", active: true,
  },
  {
    id: "dev-growth", business: "Samuel.Studio.dev", name: "Business Growth Website", category: "website",
    priceType: "starting_at", price: 1999, currency: "USD",
    inclusions: ["Professional package", "Advanced custom design", "Lead capture and CRM integration", "Advanced SEO and analytics", "Priority support"],
    exclusions: ["E-commerce", "Custom application features"],
    purchaseUrl: "https://www.paypal.com/ncp/payment/MVEQMSVCGDFQL", sourceUrl: "https://dev.samuel.studio/#pricing", reviewedAt: "2026-07-14", active: true,
  },
  {
    id: "dev-booking", business: "Samuel.Studio.dev", name: "Booking System", category: "add-on",
    priceType: "starting_at", price: 199, currency: "USD",
    inclusions: ["Appointment, service, or consultation scheduling"], exclusions: [],
    purchaseUrl: "https://www.paypal.com/ncp/payment/XWNT5W4DVYANU", sourceUrl: "https://dev.samuel.studio/#pricing", reviewedAt: "2026-07-14", active: true,
  },
  {
    id: "studio-logo", business: "Samuel.Studio", name: "Custom Logo and Identity", category: "branding",
    priceType: "custom", price: null, currency: "USD",
    inclusions: ["Scope confirmed after a creative discovery conversation"], exclusions: [], purchaseUrl: null,
    sourceUrl: "https://www.samuel.studio/services", reviewedAt: "2026-07-14", active: true,
  },
].map((offer) => OfferSchema.parse(offer));

export const offerById = new Map(offers.map((offer) => [offer.id, offer]));

export function sourceIsStale(reviewedAt: string, now = new Date()): boolean {
  const reviewed = new Date(`${reviewedAt}T00:00:00Z`);
  return Number.isNaN(reviewed.getTime()) || now.getTime() - reviewed.getTime() > 120 * 24 * 60 * 60 * 1000;
}

export function recommendPublishedOffers(conversation: string): Offer[] {
  const text = conversation.toLowerCase();
  const website = text.includes("website") || text.includes("web site") || text.includes("site") || /\b(?:landing|one|single)[ -]page\b/.test(text);
  if (!website) return [];
  const needsProfessional = /services|professional|multiple pages|about page|portfolio|all (?:our|my|the) services/.test(text);
  const needsGrowth = /crm integration|advanced seo|lead capture|growth website|ticketmaster|ticket sales?|e-?commerce|merchandise|online store|dynamic (?:game|event) schedule/.test(text);
  const primary = offerById.get(needsGrowth ? "dev-growth" : needsProfessional ? "dev-professional" : "dev-starter")!;
  return [primary, ...(text.includes("booking") || text.includes("appointment") ? [offerById.get("dev-booking")!] : [])];
}
