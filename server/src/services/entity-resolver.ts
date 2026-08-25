import type { ResolvedEntity } from "@paperclipai/db";

/**
 * Entity Resolver Service — parses natural language travel queries
 * and extracts structured entities (destinations, dates, hotels, airlines,
 * budget, categories, people counts).
 *
 * Phase R1a uses regex + keyword patterns. Covers ~70% of common travel
 * queries. Phase R1b will add LLM-based extraction as a fallback.
 *
 * @see doc/plans/2026-08-25-research-deep-dive-tech-plan.md
 */

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Airport codes: 3 uppercase letters, optionally preceded by "to " or "from "
const AIRPORT_CODE_RE = /\b([A-Z]{3})\b/g;

// Known major airport codes (expanded set)
const KNOWN_AIRPORT_CODES = new Set([
  // North America
  "JFK", "LGA", "EWR", "LAX", "SFO", "OAK", "ORD", "MDW", "DFW", "IAH",
  "HOU", "MIA", "FLL", "MCO", "BOS", "SEA", "DEN", "PHX", "LAS", "MSP",
  "DTW", "PHL", "CLT", "ATL", "DCA", "IAD", "BWI", "PDX", "STL", "TPA",
  "YYZ", "YVR", "YUL", "MEX", "CUN",
  // Europe
  "LHR", "LGW", "STN", "CDG", "ORY", "AMS", "FRA", "MUC", "TXL", "BER",
  "FCO", "CIA", "MXP", "BCN", "MAD", "ZRH", "GVA", "VIE", "CPH", "ARN",
  "OSL", "HEL", "DUB", "BRU", "LIS", "ATH", "IST", "WAW", "PRG", "BUD",
  // Asia
  "NRT", "HND", "KIX", "ICN", "PVG", "PEK", "CAN", "HKG", "SIN", "BKK",
  "DEL", "BOM", "CGK", "KUL", "MNL", "TPE", "SYD", "MEL", "AKL",
  // Middle East
  "DXB", "AUH", "DOH", "RUH", "JED",
]);

// Cities (non-airport-code destinations)
const CITY_PATTERNS = [
  // Match city after known prefixes — captures up to two capitalized words (e.g. "New York")
  /\b(?:to|in|from|visiting|going\s+to|travel(?:l?)ing\s+to|flying\s+to|heading\s+to)\s+([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*)?)(?:\s|$|,|\.|!|\?)/i,
  /\b(?:in|at)\s+([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*)?)(?:\s|$|,|\.|!|\?)/i,
];

// Date patterns
// Absolute dates: "December 15", "Dec 15", "12/15", "2024-12-15"
const ABSOLUTE_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{2,4}))?\b/gi;

// Relative dates
const RELATIVE_DATE_RE = /\b(today|tomorrow|next\s+week|this\s+weekend|next\s+weekend|this\s+week|next\s+month|next\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))\b/i;

// Date ranges — only match when both endpoints contain date-like tokens
const MONTH_TOKEN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const WEEKDAY_TOKEN = "(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)";
const RELATIVE_TOKEN = "(?:today|tomorrow|yesterday)";
const DATE_POINT = `(?:${MONTH_TOKEN}\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}\\s+${MONTH_TOKEN}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|${WEEKDAY_TOKEN}|${RELATIVE_TOKEN})`;
const DATE_RANGE_RE = new RegExp(`\\b(from\\s+)?(${DATE_POINT.slice(3, -1)})\\s*(?:to|until|through|thru|[-–])\\s*(${DATE_POINT.slice(3, -1)})\\b`, "i");

// Budget patterns
const BUDGET_RE = /\b(?:under|less\s+than|below|max(?:imum)?|budget|at\s+most|up\s+to|no\s+more\s+than)\s+\$?(\d+(?:,\d{3})*(?:\.\d{2})?)\b|\b\$?(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?|eur|euros?|gbp|pounds?)\b/gi;

// Hotel patterns
const HOTEL_RE = /\b(stay(?:ing)?\s+(?:at|in)\s+)?([A-Z][a-zA-Z\s&]{2,40}?(?:Hotel|Inn|Resort|Suites|Lodge|Hostel|Holiday\s+Inn|Marriott|Hilton|Hyatt|Sheraton|Ritz|Four\s+Seasons|Airbnb|Motel))\b/i;

// Airline patterns
const AIRLINE_RE = /\b(Delta|United|American|Southwest|JetBlue|Spirit|Alaska|Frontier|Hawaiian|Allegiant|British\s+Airways|Lufthansa|Air\s+France|Emirates|Qatar|Singapore|Cathay|ANA|JAL|Ryanair|EasyJet|Wizz|Turkish|KLM|Virgin|Aeromexico|Air\s+Canada|WestJet|Qantas|SWISS|Austrian|SAS|Norwegian|Finnair)\b/gi;

// Category patterns
const CATEGORY_RE = /\b(flights?|plane|airfare|hotels?|accommodation|stays?|activities?|things?\s*to\s*do|attractions|dining|restaurants?|food|transport|transit|car\s+rental|rental\s+car|tours?|excursions?|nightlife|shopping|museums?|beaches?|hiking)\b/gi;

// People/traveler count
const PEOPLE_RE = /\b(\d+)\s*(?:adults?|people|travelers?|passengers?|guests?|kids?|children?)\b|\b(?:for|with)\s+(\d+)\s*(?:adults?|people|travelers?|passengers?|guests?)/i;

// Room count
const ROOMS_RE = /\b(\d+)\s*(?:rooms?|bedrooms?)\b/i;

// Star rating
const STAR_RATING_RE = /\b(\d+)[-–\s]*star\b/i;

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

export interface SearchPlanEntry {
  source: "web" | "email" | "portal";
  query: string;
  priority: number; // 0-100, higher = more important
}

export interface ResolvedQuery {
  raw: string;
  entities: ResolvedEntity[];
  searchPlan: SearchPlanEntry[];
}

/**
 * Parse a natural language travel query and extract structured entities.
 *
 * @param query - Raw NL query text (max 500 chars)
 * @returns ResolvedQuery with extracted entities and search plan
 */
export function resolveQuery(query: string): ResolvedQuery {
  const entities: ResolvedEntity[] = [];
  const trimmed = query.trim();

  // Limit query length
  if (trimmed.length > 500) {
    return {
      raw: trimmed,
      entities: [],
      searchPlan: generateFallbackSearchPlan(trimmed),
    };
  }

  if (!trimmed) {
    return { raw: "", entities: [], searchPlan: [] };
  }

  // Extract destinations (airport codes)
  extractAirportCodes(trimmed, entities);

  // Extract destinations (city names)
  extractCities(trimmed, entities);

  // Extract date ranges first, then individual dates
  extractDateRanges(trimmed, entities);

  // Extract absolute dates
  extractAbsoluteDates(trimmed, entities);

  // Extract relative dates (if no absolute/range dates found)
  extractRelativeDates(trimmed, entities);

  // Extract budget constraints
  extractBudget(trimmed, entities);

  // Extract hotel references
  extractHotels(trimmed, entities);

  // Extract airline references
  extractAirlines(trimmed, entities);

  // Extract travel categories
  extractCategories(trimmed, entities);

  // Extract people counts
  extractPeople(trimmed, entities);

  // Generate search plan from entities
  const searchPlan = generateSearchPlan(trimmed, entities);

  return {
    raw: trimmed,
    entities: deduplicateEntities(entities),
    searchPlan,
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractAirportCodes(query: string, entities: ResolvedEntity[]): void {
  AIRPORT_CODE_RE.lastIndex = 0; // reset for safety (global regex with stale lastIndex)
  let match: RegExpExecArray | null;
  while ((match = AIRPORT_CODE_RE.exec(query)) !== null) {
    const code = match[1];
    if (KNOWN_AIRPORT_CODES.has(code)) {
      entities.push({
        type: "destination",
        value: code,
        normalized: code,
        confidence: 90,
        metadata: { kind: "airport_code" },
      });
    }
  }
}

function extractCities(query: string, entities: ResolvedEntity[]): void {
  // Check if we already have airport-based destinations
  const hasAirportDest = entities.some(
    (e) => e.type === "destination" && e.metadata?.kind === "airport_code",
  );

  // Standalone capitalized word — treat as destination (e.g. "Paris")
  if (/^[A-Z][a-zA-Z'-]{2,30}$/.test(query.trim())) {
    const city = query.trim();
    if (!isStopWord(city) && !KNOWN_AIRPORT_CODES.has(city.toUpperCase())) {
      entities.push({
        type: "destination",
        value: city,
        normalized: city.toLowerCase(),
        confidence: hasAirportDest ? 60 : 75,
        metadata: { kind: "city" },
      });
      return; // standalone query, nothing else to match
    }
  }

  for (const pattern of CITY_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const city = match[1].trim();
      // Skip single words that are likely verbs or prepositions
      if (isStopWord(city)) continue;
      // Skip if it's a known airport code
      if (KNOWN_AIRPORT_CODES.has(city.toUpperCase())) continue;
      entities.push({
        type: "destination",
        value: city,
        normalized: city.toLowerCase().replace(/\s+/g, "-"),
        confidence: hasAirportDest ? 60 : 75,
        metadata: { kind: "city" },
      });
    }
  }
}

function extractDateRanges(query: string, entities: ResolvedEntity[]): void {
  const match = query.match(DATE_RANGE_RE);
  if (match) {
    entities.push({
      type: "date_range",
      value: `${match[2].trim()} to ${match[3].trim()}`,
      normalized: match[2].trim(),
      confidence: 70,
      metadata: { start: match[2].trim(), end: match[3].trim() },
    });
  }
}

function extractAbsoluteDates(query: string, entities: ResolvedEntity[]): void {
  // Skip if we already have a date range (more specific)
  if (entities.some((e) => e.type === "date_range")) return;

  ABSOLUTE_DATE_RE.lastIndex = 0; // reset for safety (global regex with stale lastIndex)
  let match: RegExpExecArray | null;
  while ((match = ABSOLUTE_DATE_RE.exec(query)) !== null) {
    entities.push({
      type: "date_range",
      value: match[0],
      normalized: match[0],
      confidence: 85,
    });
  }
}

function extractRelativeDates(query: string, entities: ResolvedEntity[]): void {
  // Skip if we already have absolute/range dates
  if (entities.some((e) => e.type === "date_range")) return;

  const match = query.match(RELATIVE_DATE_RE);
  if (match) {
    entities.push({
      type: "date_range",
      value: match[1].toLowerCase(),
      normalized: normalizeRelativeDate(match[1].toLowerCase()),
      confidence: 65,
    });
  }
}

function extractBudget(query: string, entities: ResolvedEntity[]): void {
  // Reset lastIndex for global regex
  BUDGET_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BUDGET_RE.exec(query)) !== null) {
    const amount = match[1] || match[2];
    if (amount) {
      entities.push({
        type: "budget",
        value: amount.replace(/,/g, ""),
        normalized: amount.replace(/,/g, ""),
        confidence: 80,
        metadata: { currency: "USD" },
      });
    }
  }
}

function extractHotels(query: string, entities: ResolvedEntity[]): void {
  const match = query.match(HOTEL_RE);
  if (match) {
    const hotelName = match[2] || match[1]?.trim() || "";
    if (hotelName) {
      entities.push({
        type: "hotel",
        value: hotelName.trim(),
        normalized: hotelName.trim().toLowerCase().replace(/\s+/g, "-"),
        confidence: 75,
      });
    }
  }
}

function extractAirlines(query: string, entities: ResolvedEntity[]): void {
  AIRLINE_RE.lastIndex = 0; // reset for safety (global regex with stale lastIndex)
  let match: RegExpExecArray | null;
  while ((match = AIRLINE_RE.exec(query)) !== null) {
    entities.push({
      type: "airline",
      value: match[1],
      normalized: match[1].toLowerCase().replace(/\s+/g, "-"),
      confidence: 80,
    });
  }
}

function extractCategories(query: string, entities: ResolvedEntity[]): void {
  CATEGORY_RE.lastIndex = 0; // reset for safety (global regex with stale lastIndex)
  let match: RegExpExecArray | null;
  while ((match = CATEGORY_RE.exec(query)) !== null) {
    const canon = normalizeCategory(match[1].toLowerCase());
    entities.push({
      type: "category",
      value: canon,
      normalized: canon,
      confidence: 85,
    });
  }
}

function extractPeople(query: string, entities: ResolvedEntity[]): void {
  const match = query.match(PEOPLE_RE);
  if (match) {
    const count = parseInt(match[1] || match[2], 10);
    if (!isNaN(count) && count > 0 && count < 100) {
      entities.push({
        type: "people",
        value: String(count),
        normalized: String(count),
        confidence: 85,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Search plan generation
// ---------------------------------------------------------------------------

function generateSearchPlan(raw: string, entities: ResolvedEntity[]): SearchPlanEntry[] {
  const plan: SearchPlanEntry[] = [];
  const destinations = entities.filter((e) => e.type === "destination").map((e) => e.value);
  const categories = entities.filter((e) => e.type === "category").map((e) => e.value);
  const budget = entities.find((e) => e.type === "budget");
  const dateRange = entities.find((e) => e.type === "date_range");
  const hotel = entities.find((e) => e.type === "hotel");
  const airline = entities.find((e) => e.type === "airline");

  // Build targeted queries
  const parts: string[] = [];

  if (categories.length > 0) {
    parts.push(categories.join(" "));
  }

  if (destinations.length > 0) {
    parts.push(destinations.join(" "));
  }

  if (dateRange) {
    parts.push(dateRange.value);
  }

  if (budget) {
    parts.push(`$${budget.value}`);
  }

  if (hotel) {
    parts.push(hotel.value);
  }

  if (airline) {
    parts.push(airline.value);
  }

  if (parts.length > 0) {
    // Web search query — primary
    plan.push({
      source: "web",
      query: parts.join(" "),
      priority: 90,
    });

    // Alternative phrasing
    if (categories.length > 0 && destinations.length > 0) {
      plan.push({
        source: "web",
        query: `${categories[0]} ${destinations[0]} ${budget ? `under $${budget.value}` : ""}`,
        priority: 70,
      });
    }
  } else if (raw.length > 0) {
    // Fall back to the raw query as a web search
    plan.push({
      source: "web",
      query: raw,
      priority: 50,
    });
  }

  // If we have meaningful entities, also prepare an internal search
  if (destinations.length > 0 || categories.length > 0) {
    plan.push({
      source: "email",
      query: parts.length > 0 ? parts.join(" ") : raw,
      priority: 60,
    });
  }

  return plan;
}

function generateFallbackSearchPlan(query: string): SearchPlanEntry[] {
  // For queries that exceeded the length limit, do a basic web search
  return [
    {
      source: "web",
      query: query.substring(0, 200),
      priority: 50,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateEntities(entities: ResolvedEntity[]): ResolvedEntity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.type}:${e.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRelativeDate(relative: string): string {
  const map: Record<string, string> = {
    today: "today",
    tomorrow: "tomorrow",
    "next week": "next-week",
    "this week": "this-week",
    "this weekend": "this-weekend",
    "next weekend": "next-weekend",
    "next month": "next-month",
  };
  return map[relative] || relative;
}

function normalizeCategory(cat: string): string {
  const map: Record<string, string> = {
    flights: "flights",
    plane: "flights",
    airfare: "flights",
    hotels: "hotels",
    hotel: "hotels",
    accommodation: "hotels",
    stay: "hotels",
    stays: "hotels",
    activities: "activities",
    "things to do": "activities",
    attractions: "activities",
    dining: "dining",
    restaurants: "dining",
    food: "dining",
    transport: "transport",
    transit: "transport",
    "car rental": "transport",
    "rental car": "transport",
    tours: "activities",
    excursions: "activities",
  };
  return map[cat] || cat;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "may", "might", "shall", "must",
  "this", "that", "these", "those", "i", "you", "he", "she",
  "it", "we", "they", "me", "him", "her", "us", "them",
  "and", "or", "but", "if", "because", "as", "until", "while",
  "of", "at", "by", "for", "with", "about", "against", "between",
  "into", "through", "during", "before", "after", "above", "below",
  "to", "from", "up", "down", "in", "out", "on", "off", "over", "under",
  "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very",
  "just", "get", "going", "looking", "want", "need", "like",
]);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase().trim());
}
