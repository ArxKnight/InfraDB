import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { CableType, LabelWithSiteInfo, Site, SiteLocation, LabelSearchParams } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Card, CardContent, CardHeader } from '../ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { 
  Search, 
  Filter, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  CheckSquare,
  Square,
  X,
  Plus
} from 'lucide-react';
import apiClient from '../../lib/api';
import { formatLocationDisplay, formatLocationFields } from '../../lib/locationFormat';
import LabelDetailsDialog from './LabelDetailsDialog';
import LocationHierarchyDropdown, { type LocationHierarchyScope } from '../locations/LocationHierarchyDropdown';

interface LabelDatabaseProps {
  onCreateLabel?: () => void;
  initialSiteId?: number;
  fixedSiteId?: number;
  openReferenceNumber?: string;
  refreshToken?: number;
  onLabelsChanged?: () => void;
  siteCode?: string;
  emptyStateDescription?: string;
  emptyStateAction?: { label: string; onClick: () => void };
}

const LabelDatabase: React.FC<LabelDatabaseProps> = ({ 
  onCreateLabel,
  initialSiteId,
  fixedSiteId,
  openReferenceNumber,
  refreshToken,
  onLabelsChanged,
  siteCode,
  emptyStateDescription,
  emptyStateAction
}) => {
  const [labels, setLabels] = useState<LabelWithSiteInfo[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(fixedSiteId ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLabel, setDetailsLabel] = useState<LabelWithSiteInfo | null>(null);
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [goToPageInput, setGoToPageInput] = useState('');
  const [locations, setLocations] = useState<SiteLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [loadingCableTypes, setLoadingCableTypes] = useState(false);

  const normalizeRefQuery = useCallback((value: string): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const match = raw.match(/(\d{1,})$/);
    return match ? match[1].padStart(4, '0') : raw.replace(/^#/, '').trim();
  }, []);

  const [pendingOpenRef, setPendingOpenRef] = useState<string>(() => normalizeRefQuery(openReferenceNumber || ''));

  useEffect(() => {
    if (!multiSelectEnabled && selectedLabels.size > 0) {
      setSelectedLabels(new Set());
    }
  }, [multiSelectEnabled, selectedLabels.size]);

  useEffect(() => {
    if (!multiSelectEnabled || selectedLabels.size === 0) {
      setBulkDeleteConfirmOpen(false);
    }
  }, [multiSelectEnabled, selectedLabels.size]);
  
  // Search and filter state
  const [searchParams, setSearchParams] = useState<LabelSearchParams>({
    search: '',
    site_id: fixedSiteId || 0,
    reference_number: openReferenceNumber || '',
    source_location_id: undefined,
    destination_location_id: undefined,
    source_location_label: '',
    source_floor: '',
    source_suite: '',
    source_row: '',
    source_rack: '',
    source_area: '',
    destination_location_label: '',
    destination_floor: '',
    destination_suite: '',
    destination_row: '',
    destination_rack: '',
    destination_area: '',
    cable_type_id: undefined,
    created_by: '',
    limit: 25,
    offset: 0,
    sort_by: 'created_at',
    sort_order: 'DESC',
  });
  
  // Pagination state
  const [pagination, setPagination] = useState({
    total: 0,
    has_more: false,
  });

  const currentLimit = searchParams.limit || 25;
  const currentOffset = searchParams.offset || 0;
  const currentPage = Math.floor(currentOffset / currentLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / currentLimit));

  // Load sites for filter dropdown
  useEffect(() => {
    if (fixedSiteId) {
      return;
    }
    const loadSites = async () => {
      try {
        const response = await apiClient.getSites();
        if (response.success && response.data) {
          setSites(response.data.sites);
          // Set initial selected site
          if (!selectedSiteId) {
            const exists = initialSiteId
              ? response.data.sites.some((s: Site) => s.id === initialSiteId)
              : false;

            if (exists) {
              setSelectedSiteId(initialSiteId!);
            } else if (response.data.sites.length > 0) {
              setSelectedSiteId(response.data.sites[0].id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load sites:', err);
      }
    };

    loadSites();
  }, [fixedSiteId, initialSiteId]);

  // Update search params when selected site changes
  useEffect(() => {
    if (selectedSiteId) {
      setSearchParams(prev => ({
        ...prev,
        site_id: selectedSiteId,
        reference_number: prev.reference_number,
        source_location_id: undefined,
        destination_location_id: undefined,
        source_location_label: '',
        source_floor: '',
        source_suite: '',
        source_row: '',
        source_rack: '',
        source_area: '',
        destination_location_label: '',
        destination_floor: '',
        destination_suite: '',
        destination_row: '',
        destination_rack: '',
        destination_area: '',
        cable_type_id: undefined,
        offset: 0,
      }));
    }
  }, [selectedSiteId]);

  useEffect(() => {
    const normalized = normalizeRefQuery(openReferenceNumber || '');
    setPendingOpenRef(normalized);
    if (!normalized) return;
    setSearchParams((prev) => ({
      ...prev,
      reference_number: openReferenceNumber,
      offset: 0,
    }));
  }, [normalizeRefQuery, openReferenceNumber]);

  // Load site locations for the dropdown filters
  useEffect(() => {
    if (!selectedSiteId) {
      setLocations([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingLocations(true);
        const resp = await apiClient.getSiteLocations(selectedSiteId);
        if (cancelled) return;

        if (resp.success && resp.data) {
          setLocations(resp.data.locations);
        } else {
          setLocations([]);
        }
      } catch {
        if (!cancelled) setLocations([]);
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId]);

  // Load site cable types for the Cable Type dropdown filter
  useEffect(() => {
    if (!selectedSiteId) {
      setCableTypes([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingCableTypes(true);
        const resp = await apiClient.getSiteCableTypes(selectedSiteId);
        if (cancelled) return;

        if (resp.success && resp.data) {
          setCableTypes(resp.data.cable_types as CableType[]);
        } else {
          setCableTypes([]);
        }
      } catch {
        if (!cancelled) setCableTypes([]);
      } finally {
        if (!cancelled) setLoadingCableTypes(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId]);

  // Load labels
  const loadLabels = useCallback(async (params: LabelSearchParams) => {
    // Don't try to load labels if no site is selected
    if (!params.site_id) {
      setLabels([]);
      setPagination({
        total: 0,
        has_more: false,
      });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await apiClient.getLabels(params);
      
      if (response.success && response.data) {
        setLabels(response.data.labels);
        setPagination({
          total: response.data.pagination.total,
          has_more: response.data.pagination.has_more,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load labels');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load labels when search params change
  useEffect(() => {
    loadLabels(searchParams);
  }, [loadLabels, searchParams]);

  // External refresh trigger (e.g., after create/update)
  useEffect(() => {
    if (refreshToken === undefined) return;
    loadLabels(searchParams);
  }, [loadLabels, refreshToken]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchParams(prev => ({
      ...prev,
      search: value,
      offset: 0, // Reset to first page
    }));
  };

  // Handle filter changes
  const handleFilterChange = (key: keyof LabelSearchParams, value: any) => {
    setSearchParams(prev => ({
      ...prev,
      [key]: value,
      offset: 0, // Reset to first page
    }));
  };

  const sourceScope = useMemo((): LocationHierarchyScope | null => {
    if (!searchParams.source_location_label) return null;
    const scope: LocationHierarchyScope = { label: searchParams.source_location_label };
    if (searchParams.source_floor) scope.floor = searchParams.source_floor;
    if (searchParams.source_suite) scope.suite = searchParams.source_suite;
    if (searchParams.source_row) scope.row = searchParams.source_row;
    if (searchParams.source_rack) scope.rack = searchParams.source_rack;
    if (searchParams.source_area) scope.area = searchParams.source_area;
    return scope;
  }, [
    searchParams.source_location_label,
    searchParams.source_floor,
    searchParams.source_suite,
    searchParams.source_row,
    searchParams.source_rack,
    searchParams.source_area,
  ]);

  const destinationScope = useMemo((): LocationHierarchyScope | null => {
    if (!searchParams.destination_location_label) return null;
    const scope: LocationHierarchyScope = { label: searchParams.destination_location_label };
    if (searchParams.destination_floor) scope.floor = searchParams.destination_floor;
    if (searchParams.destination_suite) scope.suite = searchParams.destination_suite;
    if (searchParams.destination_row) scope.row = searchParams.destination_row;
    if (searchParams.destination_rack) scope.rack = searchParams.destination_rack;
    if (searchParams.destination_area) scope.area = searchParams.destination_area;
    return scope;
  }, [
    searchParams.destination_location_label,
    searchParams.destination_floor,
    searchParams.destination_suite,
    searchParams.destination_row,
    searchParams.destination_rack,
    searchParams.destination_area,
  ]);

  const setSideScope = useCallback((side: 'source' | 'destination', scope: LocationHierarchyScope | null) => {
    const label = scope?.label ?? '';
    const floor = scope?.floor ?? '';
    const suite = scope?.suite ?? '';
    const row = scope?.row ?? '';
    const rack = scope?.rack ?? '';
    const area = scope?.area ?? '';

    const resolved = {
      label,
      floor,
      area: floor ? area : '',
      suite: floor && !area ? suite : '',
      row: floor && !area && suite ? row : '',
      rack: floor && !area && suite && row ? rack : '',
    };

    setSearchParams((prev) => {
      if (side === 'source') {
        return {
          ...prev,
          source_location_id: undefined,
          source_location_label: resolved.label,
          source_floor: resolved.floor,
          source_suite: resolved.suite,
          source_row: resolved.row,
          source_rack: resolved.rack,
          source_area: resolved.area,
          offset: 0,
        };
      }
      return {
        ...prev,
        destination_location_id: undefined,
        destination_location_label: resolved.label,
        destination_floor: resolved.floor,
        destination_suite: resolved.suite,
        destination_row: resolved.row,
        destination_rack: resolved.rack,
        destination_area: resolved.area,
        offset: 0,
      };
    });
  }, []);

  // Handle pagination
  const handlePageChange = (direction: 'prev' | 'next') => {
    const currentOffset = searchParams.offset || 0;
    const currentLimit = searchParams.limit || 25;
    const newOffset = direction === 'next' 
      ? currentOffset + currentLimit
      : Math.max(0, currentOffset - currentLimit);
    
    setSearchParams(prev => ({
      ...prev,
      offset: newOffset,
    }));
  };

  const canGoToPage = useMemo(() => {
    const parsed = Number(goToPageInput);
    if (!Number.isFinite(parsed)) return false;
    const page = Math.floor(parsed);
    if (page < 1 || page > totalPages) return false;
    return page !== currentPage;
  }, [goToPageInput, totalPages, currentPage]);

  const handleGoToPage = useCallback(() => {
    const parsed = Number(goToPageInput);
    if (!Number.isFinite(parsed)) return;
    const page = Math.min(totalPages, Math.max(1, Math.floor(parsed)));
    const newOffset = (page - 1) * currentLimit;
    setSearchParams((prev) => ({
      ...prev,
      offset: newOffset,
    }));
  }, [goToPageInput, totalPages, currentLimit]);

  // Handle label selection
  const toggleLabelSelection = (labelId: number) => {
    setSelectedLabels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(labelId)) {
        newSet.delete(labelId);
      } else {
        newSet.add(labelId);
      }
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedLabels(new Set());
  };

  // Handle bulk operations
  const handleBulkDelete = () => {
    if (selectedLabels.size === 0) return;
    setBulkDeleteConfirmOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (selectedLabels.size === 0) {
      setBulkDeleteConfirmOpen(false);
      return;
    }

    if (!selectedSiteId) {
      setError('No site selected');
      setBulkDeleteConfirmOpen(false);
      return;
    }

    setBulkDeleting(true);
    try {
      const response = await apiClient.bulkDeleteLabels(selectedSiteId, Array.from(selectedLabels));
      if (response.success) {
        setBulkDeleteConfirmOpen(false);
        setSelectedLabels(new Set());
        loadLabels(searchParams); // Reload labels
        onLabelsChanged?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete labels');
    } finally {
      setBulkDeleting(false);
    }
  };

  const openDetails = (label: LabelWithSiteInfo) => {
    setDetailsLabel(label);
    setDetailsOpen(true);
  };

  useEffect(() => {
    if (loading) return;
    if (!pendingOpenRef) return;

    const normalizeLabelRef = (label: LabelWithSiteInfo) => {
      if (typeof label.ref_number === 'number' && Number.isFinite(label.ref_number)) {
        return String(Math.trunc(label.ref_number)).padStart(4, '0');
      }
      const raw = String(label.ref_string || label.reference_number || '').trim();
      const match = raw.match(/(\d{1,})$/);
      return match ? match[1].padStart(4, '0') : raw.replace(/^#/, '').trim();
    };

    const matched = labels.find((label) => normalizeLabelRef(label) === pendingOpenRef) || null;
    if (matched) {
      setDetailsLabel(matched);
      setDetailsOpen(true);
    }
    setPendingOpenRef('');
  }, [labels, loading, pendingOpenRef]);

  const formatRefForSiteDetails = (label: LabelWithSiteInfo): string => {
    if (typeof label.ref_number === 'number' && Number.isFinite(label.ref_number)) {
      return `#${String(label.ref_number).padStart(4, '0')}`;
    }

    const raw = label.ref_string || label.reference_number || '';
    const match = raw.match(/(\d{1,})$/);
    if (match) return `#${match[1].padStart(4, '0')}`;
    return raw;
  };

  const formatCreatedDisplay = (label: LabelWithSiteInfo): string => {
    const date = new Date(label.created_at);
    const datePart = date.toLocaleDateString('en-GB');
    const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const who = label.created_by_name || label.created_by_email || 'Unknown';
    return `${datePart} ${timePart} — ${who}`;
  };

  const clearFilters = () => {
    setSearchParams(prev => ({
      ...prev,
      search: '',
      reference_number: '',
      source_location_id: undefined,
      destination_location_id: undefined,
      source_location_label: '',
      source_floor: '',
      source_suite: '',
      source_row: '',
      source_rack: '',
      source_area: '',
      destination_location_label: '',
      destination_floor: '',
      destination_suite: '',
      destination_row: '',
      destination_rack: '',
      destination_area: '',
      cable_type_id: undefined,
      created_by: '',
      site_id: selectedSiteId || 0,
      offset: 0,
    }));
  };

  const hasActiveFilters = Boolean(
    searchParams.search ||
    searchParams.reference_number ||
    searchParams.source_location_id ||
    searchParams.destination_location_id ||
    searchParams.source_location_label ||
    searchParams.source_floor ||
    searchParams.source_suite ||
    searchParams.source_row ||
    searchParams.source_rack ||
    searchParams.source_area ||
    searchParams.destination_location_label ||
    searchParams.destination_floor ||
    searchParams.destination_suite ||
    searchParams.destination_row ||
    searchParams.destination_rack ||
    searchParams.destination_area ||
    searchParams.cable_type_id ||
    searchParams.created_by
  );

  const showSiteColumn = !fixedSiteId;

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Label Database</h2>
          <p className="text-muted-foreground">
            {pagination.total} label{pagination.total !== 1 ? 's' : ''} total
          </p>
        </div>
        
        <div className="flex gap-2">
          {!fixedSiteId && sites.length > 1 && (
            <select
              value={selectedSiteId || ''}
              onChange={(e) => setSelectedSiteId(e.target.value ? Number(e.target.value) : null)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={selectedSiteId ? "Search labels..." : "Select a site first to search labels"}
                  value={searchParams.search || ''}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  disabled={!selectedSiteId}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                disabled={!selectedSiteId}
              >
                <Filter className="h-4 w-4 mr-1" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1 bg-primary text-primary-foreground rounded-full w-2 h-2" />
                )}
              </Button>

              <Button
                type="button"
                variant={multiSelectEnabled ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setMultiSelectEnabled((v) => !v)}
                disabled={!selectedSiteId}
              >
                {multiSelectEnabled ? (
                  <CheckSquare className="h-4 w-4 mr-1" />
                ) : (
                  <Square className="h-4 w-4 mr-1" />
                )}
                Select Multiple
              </Button>
              
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="filter-reference">Reference</Label>
                <Input
                  id="filter-reference"
                  placeholder="e.g., #0001"
                  value={searchParams.reference_number || ''}
                  onChange={(e) => handleFilterChange('reference_number', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Source</Label>
                <LocationHierarchyDropdown
                  mode="scope"
                  locations={locations}
                  valueScope={sourceScope}
                  onSelectScope={(scope) => setSideScope('source', scope)}
                  placeholder={loadingLocations ? 'Loading...' : 'Any'}
                  disabled={!selectedSiteId || loadingLocations || locations.length === 0}
                />
              </div>

              <div className="space-y-2">
                <Label>Destination</Label>
                <LocationHierarchyDropdown
                  mode="scope"
                  locations={locations}
                  valueScope={destinationScope}
                  onSelectScope={(scope) => setSideScope('destination', scope)}
                  placeholder={loadingLocations ? 'Loading...' : 'Any'}
                  disabled={!selectedSiteId || loadingLocations || locations.length === 0}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-cable-type">Cable Type</Label>
                <Select
                  value={(searchParams.cable_type_id ? String(searchParams.cable_type_id) : '__ANY__') as string}
                  onValueChange={(v) => handleFilterChange('cable_type_id', v === '__ANY__' ? undefined : Number(v))}
                  disabled={!selectedSiteId || loadingCableTypes || cableTypes.length === 0}
                >
                  <SelectTrigger id="filter-cable-type">
                    <SelectValue placeholder={loadingCableTypes ? 'Loading...' : 'Any'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ANY__">Any</SelectItem>
                    {cableTypes.map((ct) => (
                      <SelectItem key={`ct-${ct.id}`} value={String(ct.id)}>
                        {ct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-created-by">Created By</Label>
                <Input
                  id="filter-created-by"
                  placeholder="username or email"
                  value={searchParams.created_by || ''}
                  onChange={(e) => handleFilterChange('created_by', e.target.value)}
                />
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Bulk operations */}
      {multiSelectEnabled && selectedLabels.size > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={clearSelection}>
            <X className="h-4 w-4 mr-1" />
            Clear Selection
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete Selected ({selectedLabels.size})
          </Button>
        </div>
      )}

      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${selectedLabels.size} label(s)?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected labels. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  void confirmBulkDelete();
                }}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Labels List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="ml-2">Loading labels...</span>
            </div>
          ) : labels.length === 0 ? (
            <div className="text-center p-12">
              <div className="space-y-4">
                <p className="text-muted-foreground text-lg">
                  {hasActiveFilters ? 'No labels match your search criteria.' : 'No labels exist yet.'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilters 
                    ? 'Try adjusting your filters to find what you\'re looking for.'
                    : (emptyStateDescription || (fixedSiteId ? 'Start by creating your first label for this site.' : 'Select a site above and start creating your first label.'))}
                </p>
                {!hasActiveFilters && (emptyStateAction || onCreateLabel) && (
                  <Button onClick={emptyStateAction?.onClick || onCreateLabel} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    {emptyStateAction?.label || 'Create Your First Label'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Table Header */}
              <div className="border-b bg-muted/50 px-4 py-3">
                <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium">
                  {multiSelectEnabled && (
                    <div className="col-span-1">
                      <span className="sr-only">Select</span>
                    </div>
                  )}

                  <div className="col-span-2">Cable Reference #</div>

                  {showSiteColumn ? (
                    <>
                      <div className="col-span-2">Site</div>
                      <div className="col-span-2">Cable Source</div>
                      <div className="col-span-2">Cable Destination</div>
                      <div className={multiSelectEnabled ? 'col-span-1' : 'col-span-2'}>Cable Type</div>
                      <div className="col-span-2">Created By</div>
                    </>
                  ) : (
                    <>
                      <div className={multiSelectEnabled ? 'col-span-3' : 'col-span-3'}>Cable Source</div>
                      <div className={multiSelectEnabled ? 'col-span-2' : 'col-span-3'}>Cable Destination</div>
                      <div className="col-span-2">Cable Type</div>
                      <div className="col-span-2">Created By</div>
                    </>
                  )}
                </div>
              </div>

              {/* Table Body */}
              <div className="divide-y">
                {labels.map((label) => {
                  const sourceText = label.source_location
                    ? (fixedSiteId && siteCode
                      ? formatLocationDisplay(label.source_location, siteCode)
                      : formatLocationFields(label.source_location))
                    : (label.source ?? '');

                  const destinationText = label.destination_location
                    ? (fixedSiteId && siteCode
                      ? formatLocationDisplay(label.destination_location, siteCode)
                      : formatLocationFields(label.destination_location))
                    : (label.destination ?? '');

                  return (
                    <div
                      key={label.id}
                      className="px-4 py-3 hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        if (multiSelectEnabled) {
                          toggleLabelSelection(label.id);
                        } else {
                          openDetails(label);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (multiSelectEnabled) {
                            toggleLabelSelection(label.id);
                          } else {
                            openDetails(label);
                          }
                        }
                      }}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center text-sm">
                        {multiSelectEnabled && (
                          <div className="col-span-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLabelSelection(label.id);
                              }}
                              className="h-6 w-6 p-0"
                            >
                              {selectedLabels.has(label.id) ? (
                                <CheckSquare className="h-4 w-4" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        )}

                        <div className="col-span-2 font-mono font-medium">
                          {fixedSiteId ? formatRefForSiteDetails(label) : label.reference_number}
                        </div>

                        {showSiteColumn ? (
                          <>
                            <div className="col-span-2">
                              <div>{label.site_name}</div>
                              {label.site_location && (
                                <div className="text-xs text-muted-foreground">
                                  {label.site_location}
                                </div>
                              )}
                            </div>

                            <div
                                className={'col-span-2 truncate'}
                              title={sourceText || undefined}
                            >
                              {sourceText || '—'}
                            </div>
                            <div
                                className={'col-span-2 truncate'}
                              title={destinationText || undefined}
                            >
                              {destinationText || '—'}
                            </div>
                              <div
                                className={(multiSelectEnabled ? 'col-span-1' : 'col-span-2') + ' truncate'}
                                title={label.cable_type?.name || undefined}
                              >
                                {label.cable_type?.name || '—'}
                              </div>
                            <div className="col-span-2 text-muted-foreground">
                              {formatCreatedDisplay(label)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                                className={(multiSelectEnabled ? 'col-span-3' : 'col-span-3') + ' truncate'}
                              title={sourceText || undefined}
                            >
                              {sourceText || '—'}
                            </div>
                            <div
                                className={(multiSelectEnabled ? 'col-span-2' : 'col-span-3') + ' truncate'}
                              title={destinationText || undefined}
                            >
                              {destinationText || '—'}
                            </div>
                              <div
                                className={'col-span-2 truncate'}
                                title={label.cable_type?.name || undefined}
                              >
                                {label.cable_type?.name || '—'}
                              </div>
                            <div className="col-span-2 text-muted-foreground">
                              {formatCreatedDisplay(label)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {fixedSiteId && (
        <LabelDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          label={detailsLabel}
          siteId={fixedSiteId}
          siteCode={siteCode || ''}
          onChanged={() => {
            setDetailsLabel(null);
            loadLabels(searchParams);
            onLabelsChanged?.();
          }}
        />
      )}

      {/* Pagination */}
      {pagination.total > currentLimit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {currentOffset + 1} to {Math.min(currentOffset + currentLimit, pagination.total)} of {pagination.total} labels
          </div>
          
          <div className="flex gap-2">
            <div className="text-sm text-muted-foreground flex items-center px-2">
              Page {currentPage} of {totalPages}
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">Go To Page</div>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={totalPages}
                step={1}
                value={goToPageInput}
                onChange={(e) => setGoToPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canGoToPage) handleGoToPage();
                  }
                }}
                className="w-24 h-9"
                aria-label="Go to page number"
                placeholder={String(currentPage)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleGoToPage}
                disabled={!canGoToPage}
              >
                Go
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange('prev')}
              disabled={searchParams.offset === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange('next')}
              disabled={!pagination.has_more}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabelDatabase;