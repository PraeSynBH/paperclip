import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Compass, Loader2, Plus, Search } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { researchTripsApi, type Trip } from "@/api/research-trips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/router";

// ── Status label / color helpers ─────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Draft", variant: "outline" },
  researching: { label: "Researching", variant: "secondary" },
  planning: { label: "Planning", variant: "default" },
  confirmed: { label: "Confirmed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Page root ────────────────────────────────────────────────────────────────

/**
 * Trips list page — shows all trips for the current company with a
 * "Create Trip" dialog.
 */
export function TripsList() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Trips" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.researchTrips.list(selectedCompanyId!),
    queryFn: () => researchTripsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const trips = data?.trips ?? [];

  // ── Create trip dialog ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      researchTripsApi.create(selectedCompanyId!, {
        title: newTitle,
        startDate: newStart ? new Date(newStart).toISOString() : undefined,
        endDate: newEnd ? new Date(newEnd).toISOString() : undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.researchTrips.list(selectedCompanyId!) });
      setDialogOpen(false);
      setNewTitle("");
      setNewStart("");
      setNewEnd("");
      navigate(`/trips/${result.trip.id}`);
    },
  });

  const filtered = searchQuery
    ? trips.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : trips;

  if (isLoading) return <PageSkeleton variant="list" />;
  if (error) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-sm text-destructive">Failed to load trips</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trips</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your travel itineraries, research, and bookings.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              New Trip
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new trip</DialogTitle>
              <DialogDescription>
                Give your trip a name and optional dates.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  placeholder="e.g. Summer in Florence"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">End date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newTitle.trim() || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Create Trip
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search trips…"
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Trip cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Compass}
          message={
            searchQuery
              ? `No trips matching "${searchQuery}"`
              : "You haven't created any trips yet. Create one to get started."
          }
          action={searchQuery ? undefined : "New Trip"}
          onAction={() => setDialogOpen(true)}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trip card ────────────────────────────────────────────────────────────────

function TripCard({ trip }: { trip: Trip }) {
  const style = STATUS_STYLES[trip.status] ?? STATUS_STYLES.draft;
  const destCount = trip.destinations?.length ?? 0;

  return (
    <Link to={`/trips/${trip.id}`} className="block">
      <Card className="h-full transition-colors hover:bg-accent/50 cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{trip.title}</CardTitle>
            <Badge variant={style.variant}>{style.label}</Badge>
          </div>
          {trip.description && (
            <CardDescription className="line-clamp-2">{trip.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {trip.startDate && (
              <span>
                {formatDate(trip.startDate)}
                {trip.endDate ? ` — ${formatDate(trip.endDate)}` : ""}
              </span>
            )}
            {destCount > 0 && (
              <span>
                {destCount} destination{destCount === 1 ? "" : "s"}
              </span>
            )}
            <span>Updated {formatDate(trip.updatedAt)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
