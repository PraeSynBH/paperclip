import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { researchTripsApi, type ResearchArtifact, type Trip } from "@/api/research-trips";
import { useTripMode } from "@/hooks/useTripMode";
import { TRIP_MODES, type TripMode } from "@/lib/tripMode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

// ── Main trip detail page ────────────────────────────────────────────────────

/**
 * Trip detail page with Plan/Prepare/Go mode rendering.
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
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Booking checklist — takes visual priority */}
      <div className="lg:col-span-2 space-y-4">
        <BookingChecklistPanel trip={trip} companyId={companyId} artifacts={artifacts} />
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
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Today view — primary */}
      <div className="lg:col-span-2 space-y-4">
        <TodayView trip={trip} artifacts={artifacts} />
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
  const total = artifacts?.length ?? 0;
  const verified = artifacts?.filter((a) => a.status === "verified").length ?? 0;
  const pending = artifacts?.filter((a) => a.status === "pending").length ?? 0;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;

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

        {total === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No research items yet. Use Plan mode to research activities and
            they&apos;ll appear here as a booking checklist.
          </p>
        ) : (
          <div className="space-y-1.5">
            {artifacts?.slice(0, 20).map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                {artifact.status === "verified" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                ) : artifact.status === "pending" ? (
                  <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                ) : (
                  <div className="h-4 w-4 shrink-0 rounded-full bg-destructive/20" />
                )}
                <span
                  className={
                    artifact.status === "verified" ? "line-through text-muted-foreground" : ""
                  }
                >
                  {artifact.title}
                </span>
                {/* "Book soon" badge for sell-out activities */}
                {artifact.status === "pending" && artifact.confidence !== null && artifact.confidence > 0.8 && (
                  <Badge variant="destructive" className="ml-auto text-[10px]">
                    Book soon
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

function UrgencySummaryPanel({
  trip: _trip,
  artifacts,
}: {
  trip: Trip;
  artifacts: ResearchArtifact[] | undefined;
}) {
  const total = artifacts?.length ?? 0;
  const pending = artifacts?.filter((a) => a.status === "pending").length ?? 0;
  const highConfidence = artifacts?.filter((a) => a.status === "pending" && a.confidence !== null && a.confidence > 0.8).length ?? 0;

  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold">Urgency Summary</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Pending items</span>
          <span className="font-medium">{pending}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Need attention</span>
          <span className="font-medium text-destructive">{highConfidence}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Booking progress</span>
          <span className="font-medium">
            {total > 0 ? `${Math.round((artifacts!.filter((a) => a.status === "verified").length / total) * 100)}%` : "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">{today}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {artifacts && artifacts.length > 0 ? (
          <div className="space-y-2">
            {artifacts.filter((a) => a.status === "verified").slice(0, 10).map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{artifact.title}</p>
                  {artifact.snippet && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {artifact.snippet}
                    </p>
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
                        if (artifact.sourceUrl) {
                          window.open(
                            `https://maps.google.com/maps?q=${encodeURIComponent(artifact.title)}`,
                            "_blank",
                          );
                        }
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
        ) : (
          <div className="py-8 text-center">
            <Compass className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-xs text-muted-foreground">
              No activities planned for today. Check your itinerary for upcoming items.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

function BackgroundProcessSummary({ companyId }: { companyId: string }) {
  // Lightweight inline version of BackgroundProcessTray — just shows running count
  // Full BackgroundProcessTray is imported directly when the full view is needed.
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Background Tasks</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Research tasks will appear here as they process.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Activity card (shared) ───────────────────────────────────────────────────

function ActivityCard({ artifact }: { artifact: ResearchArtifact }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm">{artifact.title}</span>
        {artifact.relevanceScore !== null && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {(artifact.relevanceScore * 100).toFixed(0)}%
          </Badge>
        )}
      </div>
      {artifact.snippet && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{artifact.snippet}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {artifact.sourceType}
        </Badge>
        <span
          className={`inline-flex items-center gap-1 text-[10px] ${
            artifact.status === "verified"
              ? "text-green-600 dark:text-green-400"
              : artifact.status === "rejected"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {artifact.status}
        </span>
      </div>
    </div>
  );
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
