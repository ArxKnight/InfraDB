import React, { useEffect, useMemo, useState } from 'react';
import type { SiteLocation } from '../../types';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Trash2, Loader2, Pencil } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatLocationWithPrefix } from '../../lib/locationFormat';

export interface SiteLocationsManagerProps {
  siteId: number;
  siteCode: string;
  siteName: string;
  onChanged?: () => void;
}

function formatLocationDisplay(siteName: string, siteCode: string, loc: SiteLocation): string {
  const prefix = (siteCode || siteName).toString().trim() || siteCode;
  const base = formatLocationWithPrefix(prefix, loc);
  return base;
}

const SiteLocationsManager: React.FC<SiteLocationsManagerProps> = ({ siteId, siteCode, siteName, onChanged }) => {
  const [locations, setLocations] = useState<SiteLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SiteLocation | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateUsage, setUpdateUsage] = useState<{ source_count: number; destination_count: number; total_in_use: number } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{
    locationId: number;
    payload: {
      template_type?: 'DATACENTRE' | 'DOMESTIC';
      label?: string;
      floor?: string;
      suite?: string;
      row?: string;
      rack?: string;
      rack_size_u?: number | null;
      area?: string;
    };
  } | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLocation, setDeleteLocation] = useState<SiteLocation | null>(null);
  const [deleteUsageLoading, setDeleteUsageLoading] = useState(false);
  const [deleteUsage, setDeleteUsage] = useState<{ source_count: number; destination_count: number; total_in_use: number } | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>('');
  const [cascadeAck, setCascadeAck] = useState(false);
  const [cascadeTyped, setCascadeTyped] = useState('');

  const [label, setLabel] = useState('');
  const [templateType, setTemplateType] = useState<'DATACENTRE' | 'DOMESTIC'>('DATACENTRE');
  const [floor, setFloor] = useState('');
  const [suite, setSuite] = useState('');
  const [row, setRow] = useState('');
  const [rack, setRack] = useState('');
  const [rackSizeU, setRackSizeU] = useState('');
  const [area, setArea] = useState('');

  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }, [locations]);

  const otherLocations = useMemo(() => {
    const deleteId = deleteLocation?.id;
    return deleteId ? sortedLocations.filter((l) => l.id !== deleteId) : sortedLocations;
  }, [deleteLocation?.id, sortedLocations]);

  const deleteLocationDisplay = deleteLocation ? formatLocationDisplay(siteName, siteCode, deleteLocation) : '';
  const hasDeleteUsage = (deleteUsage?.total_in_use ?? 0) > 0;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.getSiteLocations(siteId);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load locations');
      setLocations(resp.data.locations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setLabel('');
    setTemplateType('DATACENTRE');
    setFloor('');
    setSuite('');
    setRow('');
    setRack('');
    setRackSizeU('');
    setArea('');
  };

  useEffect(() => {
    if (!Number.isFinite(siteId) || siteId <= 0) return;
    setEditing(null);
    setFormOpen(false);
    resetForm();
    void load();
  }, [siteId]);

  const closeForm = () => {
    if (working) return;
    setFormOpen(false);
    setEditing(null);
    resetForm();
    setError(null);
  };

  const startAdd = () => {
    setEditing(null);
    resetForm();
    setError(null);
    setFormOpen(true);
  };

  const startEdit = (loc: SiteLocation) => {
    setEditing(loc);
    setError(null);
    setFormOpen(true);

    const tt = (loc.template_type === 'DOMESTIC' ? 'DOMESTIC' : 'DATACENTRE') as 'DATACENTRE' | 'DOMESTIC';
    setTemplateType(tt);
    setLabel(String(loc.label ?? ''));
    setFloor(String(loc.floor ?? ''));
    setSuite(String(loc.suite ?? ''));
    setRow(String(loc.row ?? ''));
    setRack(String(loc.rack ?? ''));
    setRackSizeU(loc.rack_size_u != null ? String(loc.rack_size_u) : '');
    setArea(String(loc.area ?? ''));
  };

  const cancelEdit = () => {
    closeForm();
  };

  const buildPayload = () => {
    const floorV = floor.trim();
    const suiteV = suite.trim();
    const rowV = row.trim();
    const rackV = rack.trim();
    const rackSizeUText = rackSizeU.trim();
    const rackSizeUValue = rackSizeUText === '' ? null : Number(rackSizeUText);
    const areaV = area.trim();

    return {
      template_type: templateType,
      // allow clearing label by sending empty string
      label: label.trim(),
      floor: floorV,
      ...(templateType === 'DOMESTIC'
        ? {
            area: areaV,
            suite: '',
            row: '',
            rack: '',
            rack_size_u: rackSizeUValue,
          }
        : {
            suite: suiteV,
            row: rowV,
            rack: rackV,
            rack_size_u: rackSizeUValue,
            area: '',
          }),
    };
  };

  const buildOriginalPayload = (loc: SiteLocation) => {
    const tt = (loc.template_type === 'DOMESTIC' ? 'DOMESTIC' : 'DATACENTRE') as 'DATACENTRE' | 'DOMESTIC';
    const labelV = String(loc.label ?? '').trim();
    const floorV = String(loc.floor ?? '').trim();
    const suiteV = String(loc.suite ?? '').trim();
    const rowV = String(loc.row ?? '').trim();
    const rackV = String(loc.rack ?? '').trim();
    const areaV = String(loc.area ?? '').trim();
    const rackSizeUValue = loc.rack_size_u == null ? null : Number(loc.rack_size_u);

    return {
      template_type: tt,
      label: labelV,
      floor: floorV,
      ...(tt === 'DOMESTIC'
        ? {
            area: areaV,
            suite: '',
            row: '',
            rack: '',
            rack_size_u: rackSizeUValue,
          }
        : {
            suite: suiteV,
            row: rowV,
            rack: rackV,
            rack_size_u: rackSizeUValue,
            area: '',
          }),
    };
  };

  const hasEditChanges = useMemo(() => {
    if (!editing) return true;
    return JSON.stringify(buildPayload()) !== JSON.stringify(buildOriginalPayload(editing));
  }, [editing, templateType, label, floor, suite, row, rack, rackSizeU, area]);

  const handleCreateOrUpdate = async () => {
    const floorV = floor.trim();
    const suiteV = suite.trim();
    const rowV = row.trim();
    const rackV = rack.trim();
    const rackSizeUText = rackSizeU.trim();
    const rackSizeUValue = Number(rackSizeUText);
    const areaV = area.trim();

    if (!floorV) {
      setError('Floor is required.');
      return;
    }

    if (rackSizeUText !== '' && (!Number.isFinite(rackSizeUValue) || !Number.isInteger(rackSizeUValue) || rackSizeUValue <= 0 || rackSizeUValue > 99)) {
      setError('Rack Size (U), when provided, must be a whole number between 1 and 99.');
      return;
    }

    if (templateType === 'DATACENTRE') {
      if (!suiteV || !rowV || !rackV) {
        setError('Suite, Row, and Rack are required for Datacentre/Commercial locations.');
        return;
      }
      if (!Number.isFinite(rackSizeUValue) || !Number.isInteger(rackSizeUValue) || rackSizeUValue <= 0 || rackSizeUValue > 99) {
        setError('Rack Size (U) is required and must be a whole number between 1 and 99.');
        return;
      }
    } else {
      if (!areaV) {
        setError('Area is required for Domestic locations.');
        return;
      }
    }

    try {
      setWorking(true);
      setError(null);

      if (editing?.id) {
        if (!hasEditChanges) {
          return;
        }

        const usageResp = await apiClient.getSiteLocationUsage(siteId, editing.id);
        if (!usageResp.success || !usageResp.data) throw new Error(usageResp.error || 'Failed to load location usage');

        const usage = usageResp.data.usage;
        if ((usage?.total_in_use ?? 0) > 0) {
          setPendingUpdate({ locationId: editing.id, payload: buildPayload() });
          setUpdateUsage(usage);
          setUpdateConfirmOpen(true);
          return;
        }

        const resp = await apiClient.updateSiteLocation(siteId, editing.id, buildPayload());
        if (!resp.success) throw new Error(resp.error || 'Failed to update location');
      } else {
        const resp = await apiClient.createSiteLocation(siteId, {
          template_type: templateType,
          label: label.trim() || undefined,
          floor: floorV,
          ...(templateType === 'DOMESTIC'
            ? {
                area: areaV,
                ...(rackSizeUText !== '' ? { rack_size_u: rackSizeUValue } : {}),
              }
            : {
                suite: suiteV,
                row: rowV,
                rack: rackV,
                rack_size_u: rackSizeUValue,
              }),
        });
        if (!resp.success) throw new Error(resp.error || 'Failed to create location');
      }

      setEditing(null);
      setFormOpen(false);
      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : editing ? 'Failed to update location' : 'Failed to create location');
    } finally {
      setWorking(false);
    }
  };

  const confirmUpdate = async () => {
    if (!pendingUpdate?.locationId) return;

    try {
      setWorking(true);
      setError(null);

      const resp = await apiClient.updateSiteLocation(siteId, pendingUpdate.locationId, pendingUpdate.payload);
      if (!resp.success) throw new Error(resp.error || 'Failed to update location');

      setUpdateConfirmOpen(false);
      setPendingUpdate(null);
      setUpdateUsage(null);

      setEditing(null);
      setFormOpen(false);
      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update location');
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateConfirmOpenChange = (next: boolean) => {
    if (working) return;
    setUpdateConfirmOpen(next);
    if (!next) {
      setPendingUpdate(null);
      setUpdateUsage(null);
    }
  };

  const handleDelete = async (locationId: number) => {
    const loc = locations.find((l) => l.id === locationId) ?? null;
    setDeleteLocation(loc);
    setDeleteUsage(null);
    setCascadeAck(false);
    setCascadeTyped('');

    const firstOther = locations.find((l) => l.id !== locationId);
    setReassignTargetId(firstOther?.id ? String(firstOther.id) : '');

    setDeleteOpen(true);
    if (!loc?.id) return;

    try {
      setDeleteUsageLoading(true);
      const resp = await apiClient.getSiteLocationUsage(siteId, loc.id);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load location usage');
      setDeleteUsage(resp.data.usage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load location usage');
    } finally {
      setDeleteUsageLoading(false);
    }
  };

  const confirmDeleteSimple = async () => {
    if (!deleteLocation?.id) return;

    try {
      setWorking(true);
      setError(null);

      const resp = await apiClient.deleteSiteLocation(siteId, deleteLocation.id);
      if (!resp.success) throw new Error(resp.error || 'Failed to delete location');

      setDeleteOpen(false);
      setDeleteLocation(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
    } finally {
      setWorking(false);
    }
  };

  const confirmDeleteReassign = async () => {
    if (!deleteLocation?.id) return;
    if (!reassignTargetId) {
      setError('Select a target location to reassign labels.');
      return;
    }

    try {
      setWorking(true);
      setError(null);

      const resp = await apiClient.reassignAndDeleteSiteLocation(siteId, deleteLocation.id, Number(reassignTargetId));
      if (!resp.success) throw new Error(resp.error || 'Failed to delete location');

      setDeleteOpen(false);
      setDeleteLocation(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
    } finally {
      setWorking(false);
    }
  };

  const canConfirmCascade =
    !!deleteLocation?.id &&
    !working &&
    cascadeAck &&
    cascadeTyped.trim() === deleteLocationDisplay;

  const confirmDeleteCascade = async () => {
    if (!deleteLocation?.id) return;
    if (!canConfirmCascade) return;

    try {
      setWorking(true);
      setError(null);

      const resp = await apiClient.deleteSiteLocation(siteId, deleteLocation.id, { cascade: true });
      if (!resp.success) throw new Error(resp.error || 'Failed to delete location');

      setDeleteOpen(false);
      setDeleteLocation(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteOpenChange = (next: boolean) => {
    if (working) return;
    setDeleteOpen(next);
    if (!next) {
      setDeleteLocation(null);
      setDeleteUsage(null);
      setCascadeAck(false);
      setCascadeTyped('');
    }
  };

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={startAdd} disabled={working}>Add Location</Button>
        </div>

        <Dialog open={formOpen} onOpenChange={(next) => (next ? setFormOpen(true) : closeForm())}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Location' : 'Add Location'}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Template</Label>
                <Select
                  value={templateType}
                  onValueChange={(v) => {
                    const next = v === 'DOMESTIC' ? 'DOMESTIC' : 'DATACENTRE';
                    setTemplateType(next);
                    if (next === 'DOMESTIC') {
                      setSuite('');
                      setRow('');
                      setRack('');
                      setRackSizeU('');
                    } else {
                      setArea('');
                    }
                  }}
                  disabled={working}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DATACENTRE">Datacentre / Commercial</SelectItem>
                    <SelectItem value="DOMESTIC">Domestic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Label</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional nickname" disabled={working} />
              </div>

              <div className="space-y-1">
                <Label>Floor</Label>
                <Input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="e.g., 1" disabled={working} />
              </div>

              <div className="space-y-1">
                <Label>Rack Size (U) {templateType === 'DATACENTRE' ? '' : '(Optional)'}</Label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={rackSizeU}
                  onChange={(e) => setRackSizeU(e.target.value)}
                  placeholder="e.g., 42"
                  disabled={working}
                />
              </div>

              {templateType === 'DOMESTIC' ? (
                <div className="space-y-1">
                  <Label>Area</Label>
                  <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g., Garage" disabled={working} />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Suite</Label>
                    <Input value={suite} onChange={(e) => setSuite(e.target.value)} placeholder="e.g., 1" disabled={working} />
                  </div>
                  <div className="space-y-1">
                    <Label>Row</Label>
                    <Input value={row} onChange={(e) => setRow(e.target.value)} placeholder="e.g., A" disabled={working} />
                  </div>
                  <div className="space-y-1">
                    <Label>Rack</Label>
                    <Input value={rack} onChange={(e) => setRack(e.target.value)} placeholder="e.g., 1" disabled={working} />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cancelEdit} disabled={working}>Cancel</Button>
              <Button onClick={handleCreateOrUpdate} disabled={working || (!!editing && !hasEditChanges)}>
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? (hasEditChanges ? 'Save Changes' : 'No New Changes') : 'Add Location'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="rounded-md border">
          <div className="border-b px-3 py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-3 text-sm font-semibold">
              <div>Existing Locations</div>
              <div className="text-center">Rack Size (U)</div>
              <div className="sr-only">Actions</div>
            </div>
          </div>
          {loading ? (
            <div className="p-6 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : sortedLocations.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No locations yet.</div>
          ) : (
            <div className="divide-y">
              {sortedLocations.map((loc) => (
                <div key={loc.id} className="grid grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{formatLocationDisplay(siteName, siteCode, loc)}</div>
                  </div>

                  <div className="text-sm text-center text-muted-foreground">
                    {loc.rack_size_u != null ? String(loc.rack_size_u) : '—'}
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(loc)} disabled={working} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(loc.id)}
                      className="text-destructive hover:text-destructive"
                      disabled={working}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={updateConfirmOpen} onOpenChange={handleUpdateConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Site Location</AlertDialogTitle>
            <AlertDialogDescription>
              This location is used by <span className="font-medium text-foreground">{updateUsage?.total_in_use ?? 0}</span>{' '}
              labels ({updateUsage?.source_count ?? 0} as Source, {updateUsage?.destination_count ?? 0} as Destination). Updating it will
              affect all existing cable refs that use this location.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmUpdate();
              }}
              disabled={!pendingUpdate || working}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Proceed'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Site Location</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLocationDisplay ? <span className="font-medium text-foreground">{deleteLocationDisplay}</span> : 'Choose how to delete this location.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteUsageLoading ? (
            <div className="py-4 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking usage...
            </div>
          ) : !hasDeleteUsage ? (
            <div className="text-sm text-muted-foreground">This location is not referenced by any labels.</div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                This location is used by <span className="font-medium text-foreground">{deleteUsage?.total_in_use ?? 0}</span> labels (
                {deleteUsage?.source_count ?? 0} as Source, {deleteUsage?.destination_count ?? 0} as Destination).
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-semibold">Option A — Reassign labels, then delete</div>
                <div className="space-y-1">
                  <Label>Reassign labels to</Label>
                  <Select value={reassignTargetId} onValueChange={setReassignTargetId}>
                    <SelectTrigger>
                      <SelectValue placeholder={otherLocations.length ? 'Select a location' : 'No other locations'} />
                    </SelectTrigger>
                    <SelectContent>
                      {otherLocations.map((loc) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>
                          {formatLocationDisplay(siteName, siteCode, loc)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {otherLocations.length === 0 && (
                    <div className="text-xs text-muted-foreground">Create another location first to reassign labels.</div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => void confirmDeleteReassign()} disabled={working || !reassignTargetId || otherLocations.length === 0}>
                    {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reassign & Delete'}
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-destructive/40 p-3 space-y-2">
                <div className="text-sm font-semibold text-destructive">Option B — Delete location AND labels</div>
                <div className="text-sm text-muted-foreground">This will delete all labels that use this location as Source or Destination.</div>
                <div className="flex items-start gap-2">
                  <Checkbox id="cascade-ack" checked={cascadeAck} onCheckedChange={(v) => setCascadeAck(Boolean(v))} disabled={working} />
                  <Label htmlFor="cascade-ack" className="text-sm leading-5">
                    I understand this will delete labels.
                  </Label>
                </div>
                <div className="space-y-1">
                  <Label>Type this exact location name to confirm</Label>
                  <Input value={cascadeTyped} onChange={(e) => setCascadeTyped(e.target.value)} disabled={working} />
                  <div className="text-xs text-muted-foreground">Must match exactly: {deleteLocationDisplay}</div>
                </div>
                <div className="flex justify-end">
                  <Button variant="destructive" onClick={() => void confirmDeleteCascade()} disabled={!canConfirmCascade}>
                    {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Location & Labels'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            {!hasDeleteUsage && !deleteUsageLoading && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void confirmDeleteSimple();
                }}
                disabled={!deleteLocation?.id || working}
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Location'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SiteLocationsManager;
