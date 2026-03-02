import React, { useMemo, useState } from 'react';
import type { LabelWithSiteInfo } from '../../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { apiClient } from '../../lib/api';
import { downloadBlobAsNamedTextFile, makeTimestampLocal } from '../../lib/download';
import LabelForm from './LabelForm';

function labelRefBase(label: LabelWithSiteInfo): string {
  if (label.reference_number) return label.reference_number;
  if (label.ref_string) return label.ref_string;
  if (typeof label.ref_number === 'number' && Number.isFinite(label.ref_number)) {
    return String(label.ref_number).padStart(4, '0');
  }
  return String(label.id);
}

export interface LabelDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: LabelWithSiteInfo | null;
  siteId: number;
  siteCode: string;
  onChanged: () => void;
}

const LabelDetailsDialog: React.FC<LabelDetailsDialogProps> = ({
  open,
  onOpenChange,
  label,
  siteId,
  siteCode,
  onChanged,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refBase = useMemo(() => (label ? labelRefBase(label) : ''), [label]);

  const handleDownload = async () => {
    if (!label) return;
    try {
      setError(null);
      setWorking(true);
      const blob = await apiClient.downloadLabelZpl(label.id, siteId);
      const filename = `crossrackref_${makeTimestampLocal()}.txt`;
      await downloadBlobAsNamedTextFile(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download label');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!label) return;
    try {
      setError(null);
      setWorking(true);
      const resp = await apiClient.deleteLabel(label.id, siteId);
      if (!resp.success) throw new Error(resp.error || 'Failed to delete label');
      onOpenChange(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete label');
    } finally {
      setWorking(false);
    }
  };

  const handleUpdate = async (data: any) => {
    if (!label) return;
    const resp = await apiClient.updateLabel(label.id, {
      site_id: siteId,
      source_location_id: data.source_location_id,
      destination_location_id: data.destination_location_id,
      cable_type_id: data.cable_type_id,
      notes: data.notes,
      via_patch_panel: data.via_patch_panel,
      ...(Number.isFinite(Number(data.patch_panel_sid_id)) && Number(data.patch_panel_sid_id) > 0
        ? { patch_panel_sid_id: Number(data.patch_panel_sid_id) }
        : {}),
      ...(Number.isFinite(Number(data.patch_panel_port)) && Number(data.patch_panel_port) > 0
        ? { patch_panel_port: Number(data.patch_panel_port) }
        : {}),
    });
    if (!resp.success) throw new Error(resp.error || 'Failed to update label');
    onChanged();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{label ? `Label #${refBase}` : 'Label'}</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {label && (
          <div className="flex items-center justify-between gap-2">
            <div />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleDownload} disabled={working}>
                Download Single Label .txt
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={working}>
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete label?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes label #{refBase}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {label && (
          <LabelForm
            label={label}
            onSubmit={handleUpdate}
            onCancel={() => onOpenChange(false)}
            isLoading={working}
            lockedSiteId={siteId}
            lockedSiteCode={siteCode}
            lockedSiteName={label.site_name}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LabelDetailsDialog;
