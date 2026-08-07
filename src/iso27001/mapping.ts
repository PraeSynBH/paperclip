import { ISO_27001_2022_ANNEX_A, type IsoControl } from "./annex-a.js";
import type { DrataControl, DrataFramework } from "../drata/types.js";
import { controlFrameworkNames, isControlReady } from "../drata/helpers.js";

export interface MappingResult {
  isoControl: IsoControl;
  drataControls: DrataControl[];
  matchScore: number;
  matchMethod: "tag" | "name" | "framework";
  coverage: "full" | "partial" | "none";
}

export function mapDrataToIso(
  drataControls: DrataControl[],
  drataFrameworks: DrataFramework[]
): MappingResult[] {
  const isoControls = ISO_27001_2022_ANNEX_A.flatMap((cat) => cat.controls);

  return isoControls.map((isoControl) => {
    const { matches, method } = findMatchingDrataControls(isoControl, drataControls);
    const coverage = assessCoverage(isoControl, matches, drataFrameworks);

    return {
      isoControl,
      drataControls: matches,
      matchScore: matches.length,
      matchMethod: method,
      coverage,
    };
  });
}

/** Drata's own name for the ISO 27001:2022 framework in `requirements[].frameworkName`. */
const ISO_27001_2022_FRAMEWORK_NAME = "ISO 27001:2022";

interface MatchResult {
  matches: DrataControl[];
  method: "tag" | "name" | "framework";
}

function findMatchingDrataControls(
  isoControl: IsoControl,
  controls: DrataControl[]
): MatchResult {
  // Prefer Drata's own authoritative ISO 27001:2022 linkage: `expand[]=requirements`
  // returns, for each control, the exact Annex A codes (e.g. "A.5.6") it is mapped
  // to under `frameworkName`/`name`. This is curated by Drata directly and is a
  // strictly stronger signal than the free-text tag heuristic below — several
  // controls (e.g. "Communication with Security and Privacy Organizations" for
  // A.5.6, "Employee/Disclosure Process" for A.6.8) don't share vocabulary with
  // our hand-written tags at all, so relying on tags alone under-reports coverage.
  //
  // IMPORTANT: this is the ONLY path that constitutes authoritative Drata
  // linkage. Report it as `matchMethod: "framework"` — do not fall through to
  // the tag/name heuristics below and relabel it as something weaker (RBR-909).
  const exactMatches = controls.filter((control) =>
    (control.requirements ?? []).some(
      (req) => req.frameworkName === ISO_27001_2022_FRAMEWORK_NAME && req.name === isoControl.id
    )
  );
  if (exactMatches.length > 0) return { matches: exactMatches, method: "framework" };

  // No authoritative requirements[] linkage for this control — fall back to the
  // free-text heuristics. These are internal control-mapping judgment, not
  // Drata-curated linkage, and must be labeled accordingly.
  const matched = new Set<DrataControl>();
  let nameHit = false;

  for (const tag of isoControl.drataControlTags) {
    const regex = new RegExp(tag.replace(/\s+/g, "\\s+"), "i");
    for (const control of controls) {
      if (regex.test(control.name)) nameHit = true;
      if (matched.has(control)) continue;
      if (regex.test(control.name) || regex.test(control.description)) {
        matched.add(control);
      }
    }
  }

  return { matches: [...matched], method: nameHit ? "name" : "tag" };
}

function assessCoverage(
  isoControl: IsoControl,
  matches: DrataControl[],
  frameworks: DrataFramework[]
): "full" | "partial" | "none" {
  if (matches.length === 0) return "none";
  if (matches.length >= 2) return "full";

  const match = matches[0];
  if (!match) return "partial";

  // v2 controls carry their framework linkage under `requirements`; fall back
  // to the old name-substring heuristic when that expand isn't present.
  const mappedFrameworks = controlFrameworkNames(match).map((n) => n.toLowerCase());
  const isFrameworkMapped =
    mappedFrameworks.length > 0
      ? frameworks.some((f) => mappedFrameworks.includes(f.name.toLowerCase()))
      : frameworks.some((f) => match.name?.toLowerCase().includes(f.name.toLowerCase()));

  if (isFrameworkMapped || isControlReady(match)) {
    return "full";
  }
  return "partial";
}

export interface CoverageSummary {
  totalIsoControls: number;
  full: number;
  partial: number;
  none: number;
  percentageWithCoverage: number;
  byCategory: Record<
    string,
    { category: string; total: number; full: number; partial: number; none: number }
  >;
  gapControls: IsoControl[];
}

export function summarizeCoverage(results: MappingResult[]): CoverageSummary {
  const byCat: Record<string, { total: number; full: number; partial: number; none: number }> = {};

  for (const cat of ISO_27001_2022_ANNEX_A) {
    byCat[cat.id] = { total: 0, full: 0, partial: 0, none: 0 };
  }

  for (const result of results) {
    const cat = byCat[result.isoControl.category];
    if (cat) {
      cat.total++;
      if (result.coverage === "full") cat.full++;
      else if (result.coverage === "partial") cat.partial++;
      else cat.none++;
    }
  }

  const totalFull = results.filter((r) => r.coverage === "full").length;
  const totalPartial = results.filter((r) => r.coverage === "partial").length;
  const totalNone = results.filter((r) => r.coverage === "none").length;
  const total = results.length;

  const gapControls = results
    .filter((r) => r.coverage === "none")
    .map((r) => r.isoControl);

  const summaryByCategory: CoverageSummary["byCategory"] = {};
  for (const [id, data] of Object.entries(byCat)) {
    const cat = ISO_27001_2022_ANNEX_A.find((c) => c.id === id);
    summaryByCategory[id] = { category: cat?.title ?? id, ...data };
  }

  return {
    totalIsoControls: total,
    full: totalFull,
    partial: totalPartial,
    none: totalNone,
    percentageWithCoverage: parseFloat(
      (((totalFull + totalPartial) / total) * 100).toFixed(1)
    ),
    byCategory: summaryByCategory,
    gapControls,
  };
}