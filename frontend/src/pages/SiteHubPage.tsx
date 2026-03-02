import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ArrowLeft, FileText, Edit, Trash2 } from 'lucide-react';

import type { Site } from '../types';
import { apiClient } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';

import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import SiteForm from '../components/sites/SiteForm';

type DialogMode = 'edit' | 'delete' | null;

const SiteHubPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const siteId = Number(params.siteId);

  const { canAdministerSite, isGlobalAdmin } = usePermissions();
  const canManageSite = Number.isFinite(siteId) ? canAdministerSite(siteId) : false;

  const [site, setSite] = React.useState<(Site & { label_count?: number }) | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [deleteConfirmName, setDeleteConfirmName] = React.useState('');
  const [deleteCascadeConfirmed, setDeleteCascadeConfirmed] = React.useState(false);

  const loadSite = React.useCallback(async () => {
    if (!Number.isFinite(siteId) || siteId <= 0) {
      setError('Invalid site');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const resp = await apiClient.getSite(siteId);
      if (!resp.success || !resp.data?.site) {
        throw new Error(resp.error || 'Failed to load site');
      }
      setSite(resp.data.site);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load site');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  React.useEffect(() => {
    loadSite();
  }, [loadSite]);

  const closeDialog = () => {
    setDialogMode(null);
    setError(null);
    setDeleteConfirmName('');
    setDeleteCascadeConfirmed(false);
  };

  const handleSubmitEdit = async (data: { name: string; code: string; location?: string; description?: string }) => {
    if (!site) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const resp = await apiClient.updateSite(site.id, data);
      if (!resp.success) {
        throw new Error(resp.error || 'Failed to update site');
      }

      await loadSite();
      closeDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!site) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const labelCount = Number(site.label_count ?? 0);
      const cascade = labelCount > 0;

      const resp = await apiClient.deleteSite(site.id, { cascade });
      if (!resp.success) {
        throw new Error(resp.error || 'Failed to delete site');
      }

      closeDialog();
      navigate('/sites', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading site...</span>
      </div>
    );
  }

  if (error && !site) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/sites')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sites
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/sites')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sites
        </Button>
        <Alert>
          <AlertDescription>Site not found.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const labelCount = Number(site.label_count ?? 0);
  const requiresExtraConfirmation = labelCount > 0;
  const nameMatches = deleteConfirmName.trim() === site.name;
  const canDelete = !requiresExtraConfirmation || (nameMatches && deleteCascadeConfirmed);

  return (
    <div className="space-y-6 md:px-6 lg:px-10">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/sites')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sites
        </Button>
      </div>

      <div className="text-center">
        <h1 className="text-2xl font-bold">{site.name}</h1>
        <p className="text-muted-foreground">Site Hub</p>
      </div>

      <div>
        <Card className="w-full">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center whitespace-nowrap shrink-0">
                <FileText className="mr-2 h-5 w-5" />
                Site Information
              </CardTitle>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {canManageSite && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-orange-500 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                    onClick={() => setDialogMode('edit')}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Site
                  </Button>
                )}

                {isGlobalAdmin && (
                  <Button variant="destructive" size="sm" onClick={() => setDialogMode('delete')}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Site
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Site Name</label>
              <p className="text-sm">{site.name}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Site Abbreviation</label>
              <p className="text-sm font-mono">{site.code}</p>
            </div>

            {site.location && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Site Location</label>
                <p className="text-sm">{site.location}</p>
              </div>
            )}

            {site.description && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Site Description</label>
                <p className="text-sm whitespace-pre-wrap">{site.description}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-center">Site Applications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:gap-6 sm:grid-cols-4 sm:justify-items-center">
              <div className="w-full space-y-2 text-center sm:max-w-xs">
                <Button
                  variant="outline"
                  className="w-full h-auto min-h-32 flex-col items-center justify-center gap-3 whitespace-normal text-center p-6 sm:aspect-square sm:min-h-0"
                  onClick={() => navigate(`/sites/${site.id}/cable`)}
                >
                  <img
                    src="/cableindex-title.png"
                    alt="Cable Index"
                    className="max-h-20 md:max-h-24 w-auto object-contain"
                    loading="lazy"
                  />
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Create, Manage & Print Cable Labels for this site
                </p>
              </div>

              <div className="w-full space-y-2 text-center sm:max-w-xs">
                <Button
                  variant="outline"
                  className="w-full h-auto min-h-32 flex-col items-center justify-center gap-3 whitespace-normal text-center p-6 sm:aspect-square sm:min-h-0"
                  onClick={() => navigate(`/sites/${site.id}/sid`)}
                >
                  <img
                    src="/sidindex-title.png"
                    alt="SID Index"
                    className="max-h-20 md:max-h-24 w-auto object-contain"
                    loading="lazy"
                  />
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Create & Manage Server/Device IDs (SIDS) for this site
                </p>
              </div>

              <div className="w-full space-y-2 text-center sm:max-w-xs">
                <Button
                  variant="outline"
                  className="w-full h-auto min-h-32 flex-col items-center justify-center gap-3 whitespace-normal text-center p-6 sm:aspect-square sm:min-h-0"
                  onClick={() => navigate(`/sites/${site.id}/stock`)}
                >
                  <img
                    src="/stockindex-title.png"
                    alt="Stock Index"
                    className="max-h-20 md:max-h-24 w-auto object-contain"
                    loading="lazy"
                  />
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Create & Manage Stock IDs for this site
                </p>
              </div>

              <div className="w-full space-y-2 text-center sm:max-w-xs">
                <Button
                  variant="outline"
                  className="w-full h-auto min-h-32 flex-col items-center justify-center gap-3 whitespace-normal text-center p-6 sm:aspect-square sm:min-h-0"
                  onClick={() => navigate(`/sites/${site.id}/mapindex`)}
                >
                  <img
                    src="/mapindex-title.png"
                    alt="MAPIndex"
                    className="max-h-20 md:max-h-24 w-auto object-contain"
                    loading="lazy"
                  />
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Rack elevations and cable trace for this site
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={dialogMode === 'edit'} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-[425px]" onOpenChange={closeDialog}>
          <DialogHeader>
            <DialogTitle>Edit Site</DialogTitle>
            <DialogDescription>Update the site information.</DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SiteForm site={site} onSubmit={handleSubmitEdit} onCancel={closeDialog} isLoading={isSubmitting} />
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={dialogMode === 'delete'} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-[425px]" onOpenChange={closeDialog}>
          <DialogHeader>
            <DialogTitle>Delete Site</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>Are you sure you want to delete "{site.name}"?</p>
              <p className="font-medium text-destructive">This action cannot be undone.</p>
            </DialogDescription>
          </DialogHeader>

          {requiresExtraConfirmation && (
            <div className="py-2 space-y-3">
              <Alert>
                <AlertDescription>
                  Deleting this site will also delete all associated labels.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <p className="text-sm font-medium">Type the site name to confirm:</p>
                <Input
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={site.name}
                  disabled={isSubmitting}
                  aria-label="Confirm site name"
                />
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-cascade-delete"
                  checked={deleteCascadeConfirmed}
                  onCheckedChange={(checked) => setDeleteCascadeConfirmed(checked === true)}
                  disabled={isSubmitting}
                />
                <label htmlFor="confirm-cascade-delete" className="text-sm leading-tight">
                  I understand this will delete all labels for this site.
                </label>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isSubmitting || !canDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SiteHubPage;
