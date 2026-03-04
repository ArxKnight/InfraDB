import React, { useEffect, useMemo, useState } from 'react';
import type { CableType } from '../../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
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
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export interface SiteCableTypesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: number;
  siteCode: string;
  siteName: string;
  onChanged?: () => void;
}

const SiteCableTypesDialog: React.FC<SiteCableTypesDialogProps> = ({
  open,
  onOpenChange,
  siteId,
  siteCode,
  siteName,
  onChanged,
}) => {
  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [editing, setEditing] = useState<CableType | null>(null);

  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateUsageCount, setUpdateUsageCount] = useState<number>(0);
  const [pendingUpdate, setPendingUpdate] = useState<{
    cableTypeId: number;
    payload: { name: string; description?: string | null };
  } | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCableType, setDeleteCableType] = useState<CableType | null>(null);

  const sortedCableTypes = useMemo(() => {
    return [...cableTypes].sort((a, b) => a.name.localeCompare(b.name) || (a.id ?? 0) - (b.id ?? 0));
  }, [cableTypes]);

  const hasEditChanges = useMemo(() => {
    if (!editing) return true;

    const currentName = name.trim();
    const currentDescription = description.trim() || null;
    const originalName = String(editing.name ?? '').trim();
    const originalDescription = String(editing.description ?? '').trim() || null;

    return currentName !== originalName || currentDescription !== originalDescription;
  }, [description, editing, name]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setEditing(null);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.getSiteCableTypes(siteId);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load cable types');
      setCableTypes(resp.data.cable_types as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cable types');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    resetForm();
    void load();
  }, [open, siteId]);

  const startEdit = (ct: CableType) => {
    setEditing(ct);
    setName(ct.name || '');
    setDescription(ct.description || '');
    setError(null);
  };

  const runUpdate = async (cableTypeId: number, payload: { name: string; description?: string | null }) => {
    const resp = await apiClient.updateSiteCableType(siteId, cableTypeId, payload);
    if (!resp.success) throw new Error(resp.error || 'Failed to update cable type');
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Cable type name is required.');
      return;
    }

    try {
      setWorking(true);
      setError(null);

      if (editing?.id) {
        if (!hasEditChanges) {
          return;
        }

        const payload = {
          name: trimmedName,
          description: description.trim() ? description.trim() : null,
        };

        // Warn before updating a cable type that is already in use.
        const usageResp = await apiClient.getSiteCableTypeUsage(siteId, editing.id);
        if (!usageResp.success || !usageResp.data) {
          throw new Error(usageResp.error || 'Failed to check cable type usage');
        }

        const inUse = Number((usageResp.data as any).usage?.cables_using_type ?? 0);
        if (inUse > 0) {
          setPendingUpdate({ cableTypeId: editing.id, payload });
          setUpdateUsageCount(inUse);
          setUpdateConfirmOpen(true);
          return;
        }

        await runUpdate(editing.id, payload);
      } else {
        const resp = await apiClient.createSiteCableType(siteId, {
          name: trimmedName,
          ...(description.trim() ? { description: description.trim() } : {}),
        });
        if (!resp.success) throw new Error(resp.error || 'Failed to create cable type');
      }

      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cable type');
    } finally {
      setWorking(false);
    }
  };

  const confirmUpdate = async () => {
    if (!pendingUpdate) return;
    try {
      setWorking(true);
      setError(null);

      await runUpdate(pendingUpdate.cableTypeId, pendingUpdate.payload);

      setUpdateConfirmOpen(false);
      setPendingUpdate(null);
      setUpdateUsageCount(0);

      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update cable type');
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateConfirmOpenChange = (next: boolean) => {
    if (working) return;
    setUpdateConfirmOpen(next);
    if (!next) {
      setPendingUpdate(null);
      setUpdateUsageCount(0);
    }
  };

  const handleDelete = (cableTypeId: number) => {
    const ct = cableTypes.find((c) => c.id === cableTypeId) ?? null;
    setDeleteCableType(ct);
    setDeleteOpen(true);
    setError(null);
  };

  const confirmDelete = async () => {
    if (!deleteCableType?.id) return;

    try {
      setWorking(true);
      setError(null);

      const resp = await apiClient.deleteSiteCableType(siteId, deleteCableType.id);
      if (!resp.success) throw new Error(resp.error || 'Failed to delete cable type');

      setDeleteOpen(false);
      setDeleteCableType(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete cable type');
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteOpenChange = (next: boolean) => {
    if (working) return;
    setDeleteOpen(next);
    if (!next) {
      setDeleteCableType(null);
    }
  };

  const headerSite = (siteName || siteCode).toString().trim() || siteCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cable Types — {headerSite}</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm font-semibold">{editing ? 'Edit Cable Type' : 'Add Cable Type'}</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., CAT6, SMF, OM4"
                  disabled={working}
                />
              </div>

              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  rows={2}
                  disabled={working}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {editing && (
                <Button variant="outline" onClick={resetForm} disabled={working}>
                  Cancel
                </Button>
              )}
              <Button onClick={() => void handleSubmit()} disabled={working || (!!editing && !hasEditChanges)}>
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? (hasEditChanges ? 'Save Changes' : 'No New Changes') : 'Add'}
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-semibold">Existing Cable Types</div>
            {loading ? (
              <div className="p-6 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : sortedCableTypes.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No cable types yet.</div>
            ) : (
              <div className="divide-y">
                {sortedCableTypes.map((ct) => (
                  <div key={ct.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{ct.name}</div>
                      {ct.description ? (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">{ct.description}</div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(ct)}
                        disabled={working}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(ct.id)}
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

        <AlertDialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Cable Type</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteCableType?.name ? (
                  <>
                    Delete <span className="font-medium text-foreground">{deleteCableType.name}</span>? This cannot be undone.
                  </>
                ) : (
                  'Delete this cable type? This cannot be undone.'
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void confirmDelete();
                }}
                disabled={!deleteCableType?.id || working}
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={updateConfirmOpen} onOpenChange={handleUpdateConfirmOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Update Cable Type</AlertDialogTitle>
              <AlertDialogDescription>
                This cable type is currently used by <span className="font-medium text-foreground">{updateUsageCount}</span>{' '}
                {updateUsageCount === 1 ? 'cable' : 'cables'}. Updating it will apply to all existing cable refs that use this cable type.
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
      </DialogContent>
    </Dialog>
  );
};

export default SiteCableTypesDialog;
