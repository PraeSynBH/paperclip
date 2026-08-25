import { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  ListTodo,
  MapPin,
  MessagesSquare,
  Palette,
  Settings2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { researchTripsApi, type ResearchArtifact, type Trip } from "@/api/research-trips";
import { useTripMode } from "@/hooks/useTripMode";
import { TRIP_MODES, type TripMode } from "@/lib/tripMode";
import {
  computeArtifactUrgency,
  computeUrgencySummary,
  sortUrgencyEntries,
  type UrgencyInput,
  type UrgencyLevel,
} from "@/lib/tripUrgency";
import { UrgencyBadge, UrgencyRow, SellOutWarning, BookingDeadlineBadge, UrgencyDotLegend } from "@/components/trips/UrgencyBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { FreshnessCue } from "@/components/ui/FreshnessCue";
import { backgroundJobsApi } from "@/api/background-jobs";
import type { BackgroundJob } from "@paperclipai/shared";
import { cn } from "@/lib/utils";

// ── Mode icons & labels ──────────────────────────────────────────────────────

const MODE_META: Record<TripMode, { label: string; icon: React.ReactNode; description: string }> = {
  plan: {
    label: "Plan",
    icon: <MessagesSquare className="h-5 w-5" />,
    description: "Chat with Sage to build your itinerary",
  },
  prepare: {
    label: "Prepare",
    icon: <ListTodo className="h-5 w-5" />,
    description: "Book items, check deadlines, pack for your trip",
  },
  go: {
    label: "Go",
    icon: <Compass className="h-5 w-5" />,
    description: "Your trip — today's schedule and quick actions",
  },
};

// ── Convert artifact to urgency input ────────────────────────────────────────

function toUrgencyInput(artifact: ResearchArtifact): UrgencyInput {
  return {
    status: artifact.status,
    confidence: artifact.confidence ?? null,
    relevanceScore: artifact.relevanceScore ?? null,
    fetchedAt: artifact.fetchedAt,
    expiresAt: null, // not yet stored in the schema
    sourceType: artifact.sourceType,
    title: artifact.title,
  };
}

/** Pair each artifact with its computed urgency for a mode. */
function withUrgency(
  artifacts: ResearchArtifact[] | undefined,
  mode: TripMode,
): { artifact: ResearchArtifact; urgency: ReturnType<typeof computeArtifactUrgency> }[] {
  return (artifacts ?? []).map((artifact) => ({
    artifact,
    urgency: computeArtifactUrgency(toUrgencyInput(artifact), mode),
  }));
}

// ── Main trip detail page ────────────────────────────────────────────────────

/**
 * Trip detail page with Plan/Prepare/Go mode rendering and
 * mode-aware urgency hierarchy (VOY-2284).
 *
 * Route pattern: /:companyPrefix/trips/:tripId
 */
export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  // Fetch trip
  const {
    data: tripData,
    isLoading: tripLoading,
    error: tripError,
  } = useQuery({
    queryKey: queryKeys.researchTrips.detail(selectedCompanyId!, tripId!),
    queryFn: () => researchTripsApi.get(selectedCompanyId!, tripId!),
    enabled: !!selectedCompanyId && !!tripId,
  });

  const trip = tripData?.trip;

  // Fetch research artifacts for completion signals
  const { data: artifactsData } = useQuery({
    queryKey: queryKeys.researchTrips.artifacts(selectedCompanyId!, tripId),
    queryFn: () => researchTripsApi.listArtifacts(selectedCompanyId!, { tripId }),
    enabled: !!selectedCompanyId && !!tripId,
  });

  const artifacts = artifactsData?.artifacts;

  // Trip mode detection with manual override
  const { effectiveMode, signals, override, setManualOverride, clearManualOverride } = useTripMode({
    companyId: selectedCompanyId!,
    trip,
    artifacts,
  });

  // Breadcrumbs
  useEffect(() => {
    if (trip) {
      setBreadcrumbs([
        { label: "Trips", href: "/trips" },
        { label: trip.title },
      ]);
    }
  }, [trip, setBreadcrumbs]);

  // Loading state
  if (tripLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6 px-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Error state
  if (tripError || !trip) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-sm text-destructive">
          {tripError ? "Failed to load trip" : "Trip not found"}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/trips")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to trips
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6 px-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/trips")} className="shrink-0 mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{trip.title}</h1>
            {trip.description && (
              <p className="text-sm text-muted-foreground mt-1">{trip.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
              {trip.startDate && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(trip.startDate)}
                  {trip.endDate && ` — ${formatDate(trip.endDate)}`}
                </span>
              )}
              {signals?.daysUntilStart !== null && signals?.daysUntilStart !== undefined && (
                <span className="inline-flex items-center gap-1" title={signals.startReason}>
                  <Clock className="h-3.5 w-3.5" />
                  {signals.startReason}
                </span>
              )}
              <Badge variant="outline">{trip.status}</Badge>
            </div>
          </div>
        </div>

        {/* ── Mode switcher ──────────────────────────────────────────── */}
        <ModeSwitcher
          currentMode={effectiveMode ?? "plan"}
          hasOverride={override !== null}
          onSelect={setManualOverride}
          onClear={clearManualOverride}
        />
      </div>

      <Separator />

      {/* ── Mode content ─────────────────────────────────────────────── */}
      {effectiveMode === "plan" && <PlanModePanels trip={trip} companyId={selectedCompanyId!} artifacts={artifacts} />}
      {effectiveMode === "prepare" && <PrepareModePanels trip={trip} companyId={selectedCompanyId!} artifacts={artifacts} />}
      {effectiveMode === "go" && <GoModePanels trip={trip} companyId={selectedCompanyId!} artifacts={artifacts} />}
    </div>
  );
}

// ── Mode Switcher ────────────────────────────────────────────────────────────

function ModeSwitcher({
  currentMode,
  hasOverride,
  onSelect,
  onClear,
}: {
  currentMode: TripMode;
  hasOverride: boolean;
  onSelect: (mode: TripMode) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card p-1">
      {TRIP_MODES.map((mode) => {
        const meta = MODE_META[mode];
        const isActive = mode === currentMode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onSelect(mode)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
            title={meta.description}
          >
            {meta.icon}
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
      {hasOverride && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Revert to auto-detect mode"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Plan Mode ────────────────────────────────────────────────────────────────

function PlanModePanels({
  trip,
  companyId,
  artifacts,
}: {
  trip: Trip;
  companyId: string;
  artifacts: ResearchArtifact[] | undefined;
}) {
  // In Plan mode, only grey items (unknowns) are surfaced; everything else is green
  const greyCount = artifacts
    ? computeUrgencySummary(artifacts.map(toUrgencyInput), "plan").grey
    : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Chat panel */}
      <Card className="lg:sticky lg:top-20 lg:h-[calc(100vh-10rem)] lg:overflow-y-auto">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">Chat with Sage</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Ask Sage about activities, restaurants, and things to do. Research
            results will appear inline as suggestions.
          </p>
          {/* Chat composer and message area — wire to Voyonder's chat API */}
          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
            <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-xs text-muted-foreground">
              Sage chat integration — wire to /api/companies/:id/research/queries
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Itinerary panel */}
      <div className="space-y-4">
        <ItineraryPanel trip={trip} companyId={companyId} artifacts={artifacts} compact />

        {/* In Plan mode, show a subtle card about research needs */}
        {greyCount > 0 && (
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  {greyCount} item{greyCount === 1 ? "" : "s"} need{greyCount === 1 ? "s" : ""} research
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                Ask Sage about these in the chat panel. Once verified, they&apos;ll
                appear in your itinerary.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Prepare Mode ─────────────────────────────────────────────────────────────

function PrepareModePanels({
  trip,
  companyId,
  artifacts,
}: {
  trip: Trip;
  companyId: string;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const urgencyInputs = (artifacts ?? []).map(toUrgencyInput);
  const summary = computeUrgencySummary(urgencyInputs, "prepare");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Booking checklist — takes visual priority */}
      <div className="lg:col-span-2 space-y-4">
        <BookingChecklistPanel trip={trip} companyId={companyId} artifacts={artifacts} />

        {/* Safety gaps — shown in Prepare mode only */}
        {summary.red > 0 && (
          <SafetyGapsCard artifacts={artifacts} />
        )}

        <ItineraryPanel trip={trip} companyId={companyId} artifacts={artifacts} compact />
      </div>

      {/* Urgency summary sidebar */}
      <div className="space-y-4">
        <UrgencySummaryPanel trip={trip} artifacts={artifacts} />
        <BackgroundProcessSummary companyId={companyId} />
      </div>
    </div>
  );
}

// ── Go Mode ──────────────────────────────────────────────────────────────────

function GoModePanels({
  trip,
  companyId,
  artifacts,
}: {
  trip: Trip;
  companyId: string;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const needsAttention = withUrgency(artifacts, "go").filter(
    (entry) => entry.urgency.level === "red" || entry.urgency.level === "amber",
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Today view — primary */}
      <div className="lg:col-span-2 space-y-4">
        <TodayView trip={trip} artifacts={artifacts} />

        {/* In Go mode, surface items needing immediate attention */}
        {needsAttention.length > 0 && (
          <Card className="border-red-500/30 dark:border-red-500/40">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <CardTitle className="text-sm font-semibold">Needs attention</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {needsAttention.slice(0, 5).map(({ artifact, urgency }) => (
                <div key={artifact.id} className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5">
                  <UrgencyBadge level={urgency.level} dotOnly className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{artifact.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{urgency.reason.description}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick actions sidebar */}
      <div className="space-y-4">
        <QuickActionsPanel trip={trip} companyId={companyId} />
        <ItineraryPanel trip={trip} companyId={companyId} artifacts={artifacts} compact />
      </div>
    </div>
  );
}

// ── Shared panels ────────────────────────────────────────────────────────────

function ItineraryPanel({
  trip,
  companyId: _companyId,
  artifacts,
  compact = false,
}: {
  trip: Trip;
  companyId: string;
  artifacts: ResearchArtifact[] | undefined;
  compact?: boolean;
}) {
  const pendingArtifacts = artifacts?.filter((a) => a.status === "pending") ?? [];
  const verifiedArtifacts = artifacts?.filter((a) => a.status === "verified") ?? [];
  const destCount = trip.destinations?.length ?? 0;

  return (
    <Card>
      <CardHeader className={compact ? "pb-3" : undefined}>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Itinerary</CardTitle>
          {!compact && verifiedArtifacts.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {verifiedArtifacts.length} confirmed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className={compact ? "pt-0" : undefined}>
        {trip.destinations && trip.destinations.length > 0 ? (
          <div className="space-y-3">
            {trip.destinations.map((dest, i) => (
              <div key={i} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">{dest.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{dest.location}</p>
                {dest.checkIn && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(dest.checkIn)}
                    {dest.checkOut && ` → ${formatDate(dest.checkOut)}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No destinations yet. Add them during planning.
          </p>
        )}

        {/* Activity suggestions from research artifacts */}
        {!compact && verifiedArtifacts.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Sage&apos;s suggestions
            </p>
            {verifiedArtifacts.slice(0, 5).map((artifact) => (
              <ActivityCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BookingChecklistPanel({
  trip: _trip,
  companyId: _companyId,
  artifacts,
}: {
  trip: Trip;
  companyId: string;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const items = artifacts ?? [];
  const total = items.length;
  const verified = items.filter((a) => a.status === "verified").length;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;

  // Sort by urgency: Red → Amber → Grey → Green
  const sorted = sortUrgencyEntries(withUrgency(artifacts, "prepare"));
  const summary = computeUrgencySummary((items.map(toUrgencyInput)), "prepare");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Booking Checklist</CardTitle>
          {total > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {verified}/{total} booked
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Progress bar */}
        {total > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Booking progress</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Urgency summary mini-bar */}
        {total > 0 && summary.needsAttention > 0 && (
          <div className="mb-3 flex items-center gap-2 text-xs">
            {summary.red > 0 && (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                {summary.red} blocking
              </span>
            )}
            {summary.amber > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                {summary.amber} soon
              </span>
            )}
            {summary.grey > 0 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
                {summary.grey} unknown
              </span>
            )}
          </div>
        )}

        {total === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No Sage finds yet. Ask Sage in Plan mode and
            they&apos;ll appear here as a booking checklist.
          </p>
        ) : (
          <div className="space-y-1.5">
            {sorted.slice(0, 20).map(({ artifact: real, urgency }) => (
              <div
                key={real.id}
                className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent/50",
                  urgency.level === "red" && "bg-red-500/5 dark:bg-red-500/10",
                  urgency.level === "amber" && "bg-amber-500/5 dark:bg-amber-500/10",
                  urgency.level === "grey" && "opacity-70",
                )}
              >
                {/* Status icon */}
                {real.status === "verified" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />
                ) : real.status === "rejected" ? (
                  <div className="h-4 w-4 shrink-0 rounded-full bg-destructive/20 mt-0.5" />
                ) : (
                  <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30 mt-0.5" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        real.status === "verified" ? "line-through text-muted-foreground" : "",
                      )}
                    >
                      {real.title}
                    </span>
                    {urgency.level !== "green" && (
                      <UrgencyBadge level={urgency.level} dotOnly />
                    )}
                  </div>

                  {/* Urgency row — badges for deadlines / sell-out */}
                  {urgency.level !== "green" && (
                    <div className="mt-1">
                      <UrgencyRow urgency={urgency} compact />
                    </div>
                  )}
                </div>

                {/* "Book soon" badge for urgent items */}
                {urgency.level === "red" && (
                  <Badge variant="destructive" className="ml-auto shrink-0 text-[10px]">
                    {urgency.reason.label}
                  </Badge>
                )}
                {urgency.level === "amber" && (
                  <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                    {urgency.reason.label}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Safety Gaps Card ─────────────────────────────────────────────────────────

function SafetyGapsCard({
  artifacts: _artifacts,
}: {
  artifacts: ResearchArtifact[] | undefined;
}) {
  // Safety items are identified by the urgency system (safety keywords)
  // This card just provides a container for the red items
  const items = (_artifacts ?? []).map(toUrgencyInput);
  const safetyItems = items.filter(
    (a) => computeArtifactUrgency(a, "prepare").level === "red" &&
      computeArtifactUrgency(a, "prepare").reason.reasonKey === "safety_issue",
  );

  if (safetyItems.length === 0) return null;

  return (
    <Card className="border-red-500/30 dark:border-red-500/40 bg-red-500/5 dark:bg-red-500/10">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <CardTitle className="text-sm font-semibold text-red-600 dark:text-red-400">
            Safety items
          </CardTitle>
          <Badge variant="destructive" className="ml-auto">{safetyItems.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          These items have safety or health advisories that need attention before your trip.
        </p>
        {safetyItems.slice(0, 5).map((input, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-red-500/20 bg-card p-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{input.title}</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review this before departure — may affect your plans
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Urgency Summary Panel ────────────────────────────────────────────────────

function UrgencySummaryPanel({
  trip: _trip,
  artifacts,
}: {
  trip: Trip;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const items = artifacts ?? [];
  if (items.length === 0) return null;

  const urgencyInputs = items.map(toUrgencyInput);

  // Compute summaries for both prepare and go to show what changes
  const prepareSummary = computeUrgencySummary(urgencyInputs, "prepare");
  const goSummary = computeUrgencySummary(urgencyInputs, "go");

  // Use prepare mode summary as the main display (most complete)
  const summary = prepareSummary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold">Urgency Overview</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-sm">
        {/* Red — blocking */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="text-red-600 dark:text-red-400 font-medium">Blocking</span>
          </span>
          <span className="font-medium">{summary.red}</span>
        </div>

        {/* Amber — soon */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-amber-600 dark:text-amber-400 font-medium">Soon</span>
          </span>
          <span className="font-medium">{summary.amber}</span>
        </div>

        {/* Green — on track */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-green-600 dark:text-green-400 font-medium">On track</span>
          </span>
          <span className="font-medium">{summary.green}</span>
        </div>

        {/* Grey — unknown */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
            <span className="text-muted-foreground font-medium">Unknown</span>
          </span>
          <span className="font-medium">{summary.grey}</span>
        </div>

        <Separator />

        {/* Needs attention summary */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Needs attention</span>
          <span
            className={cn(
              "font-medium",
              summary.needsAttention > 0 ? "text-destructive" : "text-green-600 dark:text-green-400",
            )}
          >
            {summary.needsAttention}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Booking progress</span>
          <span className="font-medium">
            {items.length > 0
              ? `${Math.round((items.filter((a) => a.status === "verified").length / items.length) * 100)}%`
              : "—"}
          </span>
        </div>

        <UrgencyDotLegend className="pt-1" />
      </CardContent>
    </Card>
  );
}

// ── Today View (Go mode) ─────────────────────────────────────────────────────

function TodayView({
  trip: _trip,
  artifacts,
}: {
  trip: Trip;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const entries = withUrgency(artifacts, "go");
  const needsAttention = entries.filter(
    (entry) => entry.urgency.level === "red" || entry.urgency.level === "amber",
  );
  const onTrack = entries.filter((entry) => entry.urgency.level === "green");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">{today}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length === 0 ? (
          <div className="py-8 text-center">
            <Compass className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-xs text-muted-foreground">
              No activities planned for today. Check your itinerary for upcoming items.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Items needing attention (Red/Amber) — shown prominently */}
            {needsAttention.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Needs attention
                </p>
                {needsAttention.slice(0, 5).map(({ artifact, urgency }) => (
                  <UrgencyActivityCard key={artifact.id} artifact={artifact} urgency={urgency} />
                ))}
              </div>
            )}

            {/* On-track items — collapsed section */}
            {onTrack.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground list-none flex items-center gap-1.5 py-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  On track ({onTrack.length})
                  <span className="ml-auto text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-1.5 space-y-2">
                  {onTrack.slice(0, 10).map(({ artifact: real }) => (
                    <div
                      key={real.id}
                      className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{real.title}</p>
                        {real.snippet && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {real.snippet}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {real.sourceUrl && (
                            <a
                              href={real.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              View details
                            </a>
                          )}
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => {
                              window.open(
                                `https://maps.google.com/maps?q=${encodeURIComponent(real.title)}`,
                                "_blank",
                              );
                            }}
                          >
                            How to get there
                          </button>
                        </div>
                      </div>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Urgency-aware activity card (for Go mode attention items) ────────────────

function UrgencyActivityCard({
  artifact,
  urgency,
}: {
  artifact: ResearchArtifact;
  urgency: { level: UrgencyLevel; reason: { label: string; description: string }; remainingCount: number | null; daysUntilDeadline: number | null };
}) {
  const isRed = urgency.level === "red";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 mb-2",
        isRed
          ? "border-red-500/30 dark:border-red-500/40 bg-red-500/5 dark:bg-red-500/10"
          : "border-amber-500/30 dark:border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10",
      )}
    >
      {isRed ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium">{artifact.title}</p>
          <UrgencyBadge level={urgency.level} dotOnly />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{urgency.reason.description}</p>
        {urgency.remainingCount !== null && (
          <SellOutWarning remainingCount={urgency.remainingCount} className="mt-1" />
        )}
        {urgency.daysUntilDeadline !== null && (
          <BookingDeadlineBadge daysUntilDeadline={urgency.daysUntilDeadline} className="mt-1" />
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {artifact.sourceUrl && (
            <a
              href={artifact.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View details
            </a>
          )}
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => {
              window.open(
                `https://maps.google.com/maps?q=${encodeURIComponent(artifact.title)}`,
                "_blank",
              );
            }}
          >
            How to get there
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Actions Panel ──────────────────────────────────────────────────────

function QuickActionsPanel({
  trip: _trip,
  companyId: _companyId,
}: {
  trip: Trip;
  companyId: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <Button variant="outline" className="w-full justify-start text-xs" size="sm" asChild>
          <a
            href={`https://maps.google.com/maps?q=${encodeURIComponent(_trip.title)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin className="h-3.5 w-3.5 mr-1.5" /> Map view
          </a>
        </Button>
        <Button variant="outline" className="w-full justify-start text-xs" size="sm">
          <Calendar className="h-3.5 w-3.5 mr-1.5" /> Export to calendar
        </Button>
        <Button variant="outline" className="w-full justify-start text-xs" size="sm">
          <Palette className="h-3.5 w-3.5 mr-1.5" /> Offline itinerary
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Background Process Summary ───────────────────────────────────────────────

function BackgroundProcessSummary({ companyId }: { companyId: string }) {
  const [runningJobs, setRunningJobs] = useState<BackgroundJob[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const refresh = useCallback(() => {
    backgroundJobsApi.list(companyId, { limit: 5, jobType: "research" }).then((list) => {
      if (!unmountedRef.current) {
        setRunningJobs(list.filter((j) => j.status === "queued" || j.status === "running"));
      }
    }).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    unmountedRef.current = false;
    refresh();
    return () => { unmountedRef.current = true; };
  }, [refresh]);

  // SSE for live updates
  useEffect(() => {
    try {
      const es = new EventSource(backgroundJobsApi.eventsUrl(companyId));
      eventSourceRef.current = es;
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === "background_job.status") refresh();
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(refresh, 5000);
        }
      };
    } catch { /* SSE unavailable — polling fallback below */ }
    return () => {
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    };
  }, [companyId, refresh]);

  // Polling fallback
  useEffect(() => {
    const timer = setInterval(() => {
      if (!eventSourceRef.current) refresh();
    }, 5000);
    pollTimerRef.current = timer;
    return () => { clearInterval(timer); pollTimerRef.current = null; };
  }, [refresh]);

  if (runningJobs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      <span>
        Sage is looking into that{"\u2026"}
        {runningJobs.length > 1 && <span className="ml-1">({runningJobs.length} things)</span>}
      </span>
    </div>
  );
}

// ── Activity card (shared) ───────────────────────────────────────────────────

function ActivityCard({ artifact }: { artifact: ResearchArtifact }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{artifact.title}</span>
          {/* Subtle confidence indicator */}
          {artifact.confidence !== null && (
            <span
              className="ml-1.5 inline-flex items-center gap-0.5 align-middle"
              title={`Sage is ${Math.round(artifact.confidence * 100)}% confident about this`}
            >
              {roundConfidence(artifact.confidence).map((filled, i) => (
                <span
                  key={i}
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    filled ? "bg-green-500/70" : "bg-muted-foreground/20"
                  }`}
                />
              ))}
            </span>
          )}
        </div>
        <FreshnessCue
          updatedAt={artifact.fetchedAt ?? artifact.updatedAt}
          freshThresholdMs={7 * 24 * 60 * 60 * 1000}
          staleThresholdMs={30 * 24 * 60 * 60 * 1000}
          showLabel={false}
          className="shrink-0"
        />
      </div>
      {artifact.snippet && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{artifact.snippet}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {artifact.sourceType}
        </Badge>
        {artifact.sourceName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
            via {artifact.sourceName}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 text-[10px] ${
            artifact.status === "verified"
              ? "text-green-600 dark:text-green-400"
              : artifact.status === "rejected"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {artifact.status === "verified" ? "Sage confirmed" : artifact.status}
        </span>
      </div>
    </div>
  );
}

/** Round confidence to 3 dots: 0-30%→0, 31-66%→2, 67%+→3 filled. */
function roundConfidence(score: number): [boolean, boolean, boolean] {
  if (score >= 0.67) return [true, true, true];
  if (score >= 0.31) return [true, true, false];
  return [true, false, false];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
