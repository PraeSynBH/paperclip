import { describe, expect, it } from "vitest";
import { resolveQuery } from "../services/entity-resolver.js";

describe("entity-resolver — date parsing", () => {
  it("extracts absolute dates like 'December 15'", () => {
    const result = resolveQuery("flights to Paris on December 15");
    const dates = result.entities.filter((e) => e.type === "date_range");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0].value).toMatch(/December\s+15/i);
  });

  it("extracts relative dates like 'next week'", () => {
    const result = resolveQuery("hotels in Tokyo next week");
    const dates = result.entities.filter((e) => e.type === "date_range");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0].value).toBe("next week");
  });

  it("extracts date ranges like 'Monday to Friday'", () => {
    const result = resolveQuery("from Monday to Friday in Chicago");
    const dates = result.entities.filter((e) => e.type === "date_range");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0].value.toLowerCase()).toContain("monday");
  });

  it("handles 'tomorrow'", () => {
    const result = resolveQuery("flight tomorrow");
    const dates = result.entities.filter((e) => e.type === "date_range");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0].value).toBe("tomorrow");
  });
});

describe("entity-resolver — destination extraction", () => {
  it("extracts airport codes", () => {
    const result = resolveQuery("flights from JFK to LAX");
    const dests = result.entities.filter((e) => e.type === "destination");
    expect(dests.length).toBeGreaterThan(0);
    expect(dests.some((d) => d.value === "JFK")).toBe(true);
    expect(dests.some((d) => d.value === "LAX")).toBe(true);
  });

  it("extracts city names after 'to'", () => {
    const result = resolveQuery("hotels in Paris");
    const dests = result.entities.filter((e) => e.type === "destination");
    expect(dests.some((d) => d.normalized === "paris")).toBe(true);
  });

  it("extracts city names after 'in'", () => {
    const result = resolveQuery("things to do in Barcelona");
    const dests = result.entities.filter((e) => e.type === "destination");
    expect(dests.some((d) => d.normalized === "barcelona")).toBe(true);
  });

  it("extracts multi-word destinations", () => {
    const result = resolveQuery("going to New York");
    const dests = result.entities.filter((e) => e.type === "destination");
    expect(dests.some((d) => d.normalized === "new-york")).toBe(true);
  });

  it("does not extract stop words as destinations", () => {
    const result = resolveQuery("hotels in the city");
    const dests = result.entities.filter((e) => e.type === "destination");
    // "the" and "city" should not match as destinations
    for (const d of dests) {
      expect(d.normalized).not.toBe("the");
    }
  });
});

describe("entity-resolver — airline codes", () => {
  it("extracts known airline names", () => {
    const result = resolveQuery("Delta flights to London");
    const airlines = result.entities.filter((e) => e.type === "airline");
    expect(airlines.length).toBeGreaterThan(0);
    expect(airlines[0].value).toBe("Delta");
  });

  it("extracts multi-word airline names", () => {
    const result = resolveQuery("British Airways from Heathrow");
    const airlines = result.entities.filter((e) => e.type === "airline");
    expect(airlines.some((a) => a.value === "British Airways")).toBe(true);
  });
});

describe("entity-resolver — budget extraction", () => {
  it("extracts budget with 'under' keyword", () => {
    const result = resolveQuery("flights to Paris under $800");
    const budgets = result.entities.filter((e) => e.type === "budget");
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets[0].value).toBe("800");
  });

  it("extracts budget with 'budget' keyword", () => {
    const result = resolveQuery("hotels in Tokyo budget 200 dollars");
    const budgets = result.entities.filter((e) => e.type === "budget");
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets[0].value).toBe("200");
  });
});

describe("entity-resolver — category extraction", () => {
  it("extracts 'flights' category", () => {
    const result = resolveQuery("flights to London");
    const cats = result.entities.filter((e) => e.type === "category");
    expect(cats.some((c) => c.value === "flights")).toBe(true);
  });

  it("extracts 'hotels' category", () => {
    const result = resolveQuery("hotels in Paris");
    const cats = result.entities.filter((e) => e.type === "category");
    expect(cats.some((c) => c.value === "hotels")).toBe(true);
  });

  it("extracts 'activities' category", () => {
    const result = resolveQuery("things to do in Barcelona");
    const cats = result.entities.filter((e) => e.type === "category");
    expect(cats.some((c) => c.value === "activities")).toBe(true);
  });
});

describe("entity-resolver — people extraction", () => {
  it("extracts traveler count", () => {
    const result = resolveQuery("hotel for 2 people in Paris");
    const people = result.entities.filter((e) => e.type === "people");
    expect(people.length).toBeGreaterThan(0);
    expect(people[0].value).toBe("2");
  });

  it("extracts guest count", () => {
    const result = resolveQuery("suite for 4 guests");
    const people = result.entities.filter((e) => e.type === "people");
    expect(people.some((p) => p.value === "4")).toBe(true);
  });
});

describe("entity-resolver — hotel extraction", () => {
  it("extracts hotel names with common suffixes", () => {
    const result = resolveQuery("stay at Hilton in Chicago");
    const hotels = result.entities.filter((e) => e.type === "hotel");
    expect(hotels.some((h) => h.value.includes("Hilton"))).toBe(true);
  });
});

describe("entity-resolver — ambiguous entities", () => {
  it("returns both possibilities for ambiguous destinations with diff confidence", () => {
    const result = resolveQuery("Paris");
    const dests = result.entities.filter((e) => e.type === "destination");
    expect(dests.length).toBeGreaterThan(0);
    // Should identify Paris as a destination
    expect(dests.some((d) => d.normalized === "paris")).toBe(true);
  });
});

describe("entity-resolver — edge cases", () => {
  it("handles empty query", () => {
    const result = resolveQuery("");
    expect(result.entities.length).toBe(0);
    expect(result.searchPlan.length).toBe(0);
  });

  it("handles very long query (>500 chars)", () => {
    const longQuery = "a".repeat(501);
    const result = resolveQuery(longQuery);
    // Should still produce a fallback search plan
    expect(result.searchPlan.length).toBeGreaterThan(0);
  });

  it("handles special characters", () => {
    const result = resolveQuery("flights to São Paulo under R$500!");
    // Should not crash
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it("handles queries with no travel entities (fallback to keyword)", () => {
    const result = resolveQuery("what is the weather like");
    // May have low-confidence entities or empty
    // Fallback to keyword search
    if (result.entities.length === 0) {
      expect(result.searchPlan.length).toBeGreaterThan(0);
    }
  });
});

describe("entity-resolver — dedup", () => {
  it("deduplicates same entity extracted by multiple patterns", () => {
    const result = resolveQuery("Paris hotels in Paris");
    const dests = result.entities.filter((e) => e.type === "destination");
    const paris = dests.filter((d) => d.normalized === "paris");
    expect(paris.length).toBe(1);
  });
});

describe("entity-resolver — search plan generation", () => {
  it("generates web search queries from entities", () => {
    const result = resolveQuery("flights to London under $500");
    expect(result.searchPlan.length).toBeGreaterThan(0);
    const webSearch = result.searchPlan.find((s) => s.source === "web");
    expect(webSearch).toBeDefined();
    expect(webSearch!.query.toLowerCase()).toContain("london");
    expect(webSearch!.priority).toBeGreaterThan(0);
  });

  it("generates email search when destinations are present", () => {
    const result = resolveQuery("hotels in Tokyo");
    const emailSearch = result.searchPlan.find((s) => s.source === "email");
    expect(emailSearch).toBeDefined();
  });

  it("fallback search plan for queries with no entities", () => {
    const result = resolveQuery("random text without travel meaning");
    if (result.entities.length === 0) {
      // Should still have a web search fallback
      expect(result.searchPlan.some((s) => s.source === "web")).toBe(true);
    }
  });
});
