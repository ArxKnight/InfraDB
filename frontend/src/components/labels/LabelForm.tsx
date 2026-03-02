import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CableType, Label as LabelType, SiteLocation, CreateLabelData } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Loader2 } from 'lucide-react';
import apiClient from '../../lib/api';
import LocationHierarchyDropdown from '../locations/LocationHierarchyDropdown';

const labelSchema = z.object({
  source_location_id: z.coerce.number().min(1, 'Source location is required'),
  destination_location_id: z.coerce.number().min(1, 'Destination location is required'),
  cable_type_id: z.coerce.number().min(1, 'Cable type is required'),
  site_id: z.coerce.number().min(1, 'Valid site ID is required'),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(500, 'Quantity cannot exceed 500').optional(),
  notes: z.string()
    .max(1000, 'Notes must be less than 1000 characters')
    .optional()
    .or(z.literal('')),
  via_patch_panel: z.boolean().optional(),
  patch_panel_sid_id: z.coerce.number().int().positive('Patch panel is required when enabled').optional(),
  patch_panel_port: z.coerce.number().int().positive('Patch panel port is required when enabled').optional(),
}).superRefine((data, ctx) => {
  if (data.via_patch_panel) {
    if (!Number.isFinite(Number(data.patch_panel_sid_id)) || Number(data.patch_panel_sid_id) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patch_panel_sid_id'],
        message: 'Patch panel is required when enabled',
      });
    }
    if (!Number.isFinite(Number(data.patch_panel_port)) || Number(data.patch_panel_port) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patch_panel_port'],
        message: 'Patch panel port is required when enabled',
      });
    }
  }
});

type LabelFormData = z.infer<typeof labelSchema>;

interface LabelFormProps {
  label?: LabelType;
  onSubmit: (data: CreateLabelData) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  initialSiteId?: number;
  lockedSiteId?: number;
  lockedSiteCode?: string;
  lockedSiteName?: string;
}

const LabelForm: React.FC<LabelFormProps> = ({ 
  label, 
  onSubmit, 
  onCancel, 
  isLoading = false,
  initialSiteId,
  lockedSiteId,
  lockedSiteCode,
  lockedSiteName
}) => {
  const [error, setError] = useState<string | null>(null);
  const siteLocked = Number.isFinite(lockedSiteId) && (lockedSiteId || 0) > 0;
  const [loadingSites, setLoadingSites] = useState(!siteLocked);
  const [locations, setLocations] = useState<SiteLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(siteLocked);
  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [loadingCableTypes, setLoadingCableTypes] = useState(siteLocked);
  const [patchPanelSids, setPatchPanelSids] = useState<Array<{ id: number; sid_number: string; hostname: string; maxPorts: number | null }>>([]);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<LabelFormData>({
    resolver: zodResolver(labelSchema),
    defaultValues: {
      source_location_id: label?.source_location_id || 0,
      destination_location_id: label?.destination_location_id || 0,
      cable_type_id: label?.cable_type_id || 0,
      site_id: label?.site_id || lockedSiteId || initialSiteId || 0,
      quantity: 1,
      notes: label?.notes || '',
      via_patch_panel: Boolean(label?.via_patch_panel),
      patch_panel_sid_id:
        Number.isFinite(Number(label?.patch_panel_sid_id)) && Number(label?.patch_panel_sid_id) > 0
          ? Number(label?.patch_panel_sid_id)
          : undefined,
      patch_panel_port:
        Number.isFinite(Number(label?.patch_panel_port)) && Number(label?.patch_panel_port) > 0
          ? Number(label?.patch_panel_port)
          : undefined,
    },
  });

  const watchedValues = watch();

  // Labels are always created within a site in the Site Details flow.
  useEffect(() => {
    if (!siteLocked) return;
    setLoadingSites(false);
  }, [siteLocked]);

  // Lock the site context when provided
  useEffect(() => {
    if (siteLocked && lockedSiteId) {
      setValue('site_id', lockedSiteId, { shouldValidate: true });
    }
  }, [lockedSiteId, setValue, siteLocked]);

  // Load locations + cable types for the locked site
  useEffect(() => {
    const siteId = getValues('site_id');
    if (!siteId) return;

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingLocations(true);
        setLoadingCableTypes(true);
        setError(null);

        const [locResp, ctResp, sidsResp, deviceModelsResp] = await Promise.all([
          apiClient.getSiteLocations(siteId),
          apiClient.getSiteCableTypes(siteId),
          apiClient.getSiteSids(siteId, { limit: 1000, offset: 0 }),
          apiClient.getSiteSidDeviceModels(siteId),
        ]);

        if (!locResp.success || !locResp.data) {
          throw new Error(locResp.error || 'Failed to load site locations');
        }

        if (!ctResp.success || !ctResp.data) {
          throw new Error(ctResp.error || 'Failed to load cable types');
        }

        if (!sidsResp.success || !sidsResp.data) {
          throw new Error(sidsResp.error || 'Failed to load site SIDs');
        }

        if (!deviceModelsResp.success || !deviceModelsResp.data) {
          throw new Error(deviceModelsResp.error || 'Failed to load SID device models');
        }

        if (cancelled) return;
        setLocations(locResp.data.locations);
        setCableTypes(ctResp.data.cable_types as any);

        const modelMap = new Map<number, { is_patch_panel: boolean; default_patch_panel_port_count: number | null }>();
        for (const model of deviceModelsResp.data.device_models ?? []) {
          const modelId = Number((model as any)?.id ?? 0);
          if (!Number.isFinite(modelId) || modelId <= 0) continue;
          const isPatchPanel = Number((model as any)?.is_patch_panel ?? 0) === 1 || (model as any)?.is_patch_panel === true;
          const defaultPatchPanelPortCountRaw = Number((model as any)?.default_patch_panel_port_count ?? 0);
          const defaultPatchPanelPortCount = Number.isFinite(defaultPatchPanelPortCountRaw) && defaultPatchPanelPortCountRaw > 0
            ? Math.floor(defaultPatchPanelPortCountRaw)
            : null;
          modelMap.set(modelId, {
            is_patch_panel: isPatchPanel,
            default_patch_panel_port_count: defaultPatchPanelPortCount,
          });
        }

        const patchPanels = (sidsResp.data.sids ?? [])
          .map((sid: any) => {
            const sidId = Number(sid?.id ?? 0);
            const sidNumber = String(sid?.sid_number ?? '').trim();
            const hostname = String(sid?.hostname ?? '').trim();
            const modelId = Number(sid?.device_model_id ?? 0);
            const model = modelMap.get(modelId);
            if (!model?.is_patch_panel) return null;

            const sidSwitchPortCountRaw = Number(sid?.switch_port_count ?? 0);
            const sidSwitchPortCount = Number.isFinite(sidSwitchPortCountRaw) && sidSwitchPortCountRaw > 0
              ? Math.floor(sidSwitchPortCountRaw)
              : null;

            const maxPorts = sidSwitchPortCount ?? model.default_patch_panel_port_count ?? null;
            if (!Number.isFinite(sidId) || sidId <= 0 || !sidNumber) return null;
            return {
              id: sidId,
              sid_number: sidNumber,
              hostname,
              maxPorts,
            };
          })
          .filter((item): item is { id: number; sid_number: string; hostname: string; maxPorts: number | null } => Boolean(item))
          .sort((a, b) => a.sid_number.localeCompare(b.sid_number, undefined, { numeric: true, sensitivity: 'base' }));

        setPatchPanelSids(patchPanels);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load site data');
        }
      } finally {
        if (!cancelled) {
          setLoadingLocations(false);
          setLoadingCableTypes(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [getValues, lockedSiteId, lockedSiteCode, lockedSiteName]);

  const viaPatchPanel = Boolean(watchedValues.via_patch_panel);
  const selectedPatchPanelSidId = Number(watchedValues.patch_panel_sid_id ?? 0);
  const selectedPatchPanel = patchPanelSids.find((sid) => sid.id === selectedPatchPanelSidId) ?? null;
  const selectedPatchPanelPortCount = selectedPatchPanel?.maxPorts ?? null;

  useEffect(() => {
    if (!viaPatchPanel) {
      setValue('patch_panel_sid_id', undefined, { shouldValidate: true });
      setValue('patch_panel_port', undefined, { shouldValidate: true });
      return;
    }

    if (!selectedPatchPanel) {
      setValue('patch_panel_port', undefined, { shouldValidate: true });
      return;
    }

    const currentPort = Number(watchedValues.patch_panel_port ?? 0);
    if (selectedPatchPanelPortCount && selectedPatchPanelPortCount > 0) {
      if (!Number.isFinite(currentPort) || currentPort < 1 || currentPort > selectedPatchPanelPortCount) {
        setValue('patch_panel_port', 1, { shouldValidate: true });
      }
    }
  }, [
    viaPatchPanel,
    selectedPatchPanel,
    selectedPatchPanelPortCount,
    watchedValues.patch_panel_port,
    setValue,
  ]);

  const handleFormSubmit = async (data: LabelFormData) => {
    try {
      setError(null);
      const quantity = data.quantity ? Number(data.quantity) : 1;
      const submitData: CreateLabelData = {
        source_location_id: Number(data.source_location_id),
        destination_location_id: Number(data.destination_location_id),
        cable_type_id: Number(data.cable_type_id),
        site_id: data.site_id,
        ...(label || quantity <= 1 ? {} : { quantity }),
        notes: data.notes || undefined,
        via_patch_panel: Boolean(data.via_patch_panel),
        ...(data.via_patch_panel && Number.isFinite(Number(data.patch_panel_sid_id)) && Number(data.patch_panel_sid_id) > 0
          ? { patch_panel_sid_id: Number(data.patch_panel_sid_id) }
          : {}),
        ...(data.via_patch_panel && Number.isFinite(Number(data.patch_panel_port)) && Number(data.patch_panel_port) > 0
          ? { patch_panel_port: Number(data.patch_panel_port) }
          : {}),
      };
      await onSubmit(submitData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save label');
    }
  };

  if (loadingSites || loadingLocations || loadingCableTypes) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (siteLocked && locations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No site locations exist yet. Ask an admin to add locations for this site.
      </div>
    );
  }

  if (siteLocked && cableTypes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No cable types exist yet. Ask an admin to add cable types for this site.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {/* Always register site_id so it is included in submission */}
        <input type="hidden" {...register('site_id', { valueAsNumber: true })} />
        <input type="hidden" {...register('via_patch_panel')} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="source_location_id">Source Location *</Label>
            <input type="hidden" {...register('source_location_id', { valueAsNumber: true })} />
            <LocationHierarchyDropdown
              locations={locations}
              valueLocationId={watchedValues.source_location_id ? Number(watchedValues.source_location_id) : null}
              placeholder="Source"
              disabled={isLoading}
              onSelect={(id) => setValue('source_location_id', id, { shouldValidate: true })}
            />
            {errors.source_location_id && (
              <p className="text-sm text-destructive">{errors.source_location_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination_location_id">Destination Location *</Label>
            <input type="hidden" {...register('destination_location_id', { valueAsNumber: true })} />
            <LocationHierarchyDropdown
              locations={locations}
              valueLocationId={watchedValues.destination_location_id ? Number(watchedValues.destination_location_id) : null}
              placeholder="Destination"
              disabled={isLoading}
              onSelect={(id) => setValue('destination_location_id', id, { shouldValidate: true })}
            />
            {errors.destination_location_id && (
              <p className="text-sm text-destructive">{errors.destination_location_id.message}</p>
            )}
          </div>
        </div>

        {!label && (
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              max={500}
              step={1}
              {...register('quantity', { valueAsNumber: true })}
              disabled={isLoading}
            />
            {errors.quantity && (
              <p className="text-sm text-destructive">{errors.quantity.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Create multiple labels with the same details
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="cable_type_id">Cable Type *</Label>
          <input type="hidden" {...register('cable_type_id', { valueAsNumber: true })} />
          <Select
            value={watchedValues.cable_type_id ? String(Number(watchedValues.cable_type_id)) : ''}
            onValueChange={(value) => setValue('cable_type_id', Number(value), { shouldValidate: true })}
            disabled={isLoading || cableTypes.length === 0}
          >
            <SelectTrigger id="cable_type_id">
              <SelectValue placeholder={cableTypes.length ? 'Select a cable type' : 'No cable types'} />
            </SelectTrigger>
            <SelectContent>
              {cableTypes.map((ct) => (
                <SelectItem key={ct.id} value={String(ct.id)}>
                  {ct.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.cable_type_id && (
            <p className="text-sm text-destructive">{errors.cable_type_id.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Additional information about this cable (cable type, length, special requirements, etc.)"
            rows={3}
            {...register('notes')}
            disabled={isLoading}
          />
          {errors.notes && (
            <p className="text-sm text-destructive">{errors.notes.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Optional details for reference and troubleshooting
          </p>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="via_patch_panel">Runs via Patch Panel</Label>
              <p className="text-xs text-muted-foreground">Enable to attach this cable run to a patch panel and port.</p>
            </div>
            <Switch
              id="via_patch_panel"
              checked={viaPatchPanel}
              onCheckedChange={(checked) => setValue('via_patch_panel', Boolean(checked), { shouldValidate: true })}
              disabled={isLoading}
              aria-label="Runs via patch panel"
            />
          </div>

          {viaPatchPanel && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patch_panel_sid_id">Patch Panel *</Label>
                <input type="hidden" {...register('patch_panel_sid_id', { valueAsNumber: true })} />
                <Select
                  value={selectedPatchPanelSidId > 0 ? String(selectedPatchPanelSidId) : ''}
                  onValueChange={(value) => {
                    setValue('patch_panel_sid_id', Number(value), { shouldValidate: true });
                    setValue('patch_panel_port', undefined, { shouldValidate: true });
                  }}
                  disabled={isLoading || patchPanelSids.length === 0}
                >
                  <SelectTrigger id="patch_panel_sid_id">
                    <SelectValue placeholder={patchPanelSids.length ? 'Select a patch panel SID' : 'No patch panel SIDs available'} />
                  </SelectTrigger>
                  <SelectContent>
                    {patchPanelSids.map((sid) => (
                      <SelectItem key={sid.id} value={String(sid.id)}>
                        {sid.sid_number}
                        {sid.hostname ? ` — ${sid.hostname}` : ''}
                        {sid.maxPorts ? ` (${sid.maxPorts} ports)` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.patch_panel_sid_id && (
                  <p className="text-sm text-destructive">{errors.patch_panel_sid_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="patch_panel_port">Patch Panel Port *</Label>
                <input type="hidden" {...register('patch_panel_port', { valueAsNumber: true })} />
                <Select
                  value={Number.isFinite(Number(watchedValues.patch_panel_port)) && Number(watchedValues.patch_panel_port) > 0
                    ? String(Number(watchedValues.patch_panel_port))
                    : ''}
                  onValueChange={(value) => setValue('patch_panel_port', Number(value), { shouldValidate: true })}
                  disabled={
                    isLoading ||
                    !selectedPatchPanel ||
                    !selectedPatchPanelPortCount ||
                    selectedPatchPanelPortCount < 1
                  }
                >
                  <SelectTrigger id="patch_panel_port">
                    <SelectValue placeholder="Select patch panel port" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedPatchPanelPortCount && selectedPatchPanelPortCount > 0
                      ? Array.from({ length: selectedPatchPanelPortCount }, (_, index) => index + 1).map((port) => (
                          <SelectItem key={port} value={String(port)}>
                            Port {port}
                          </SelectItem>
                        ))
                      : null}
                  </SelectContent>
                </Select>
                {selectedPatchPanel && (!selectedPatchPanelPortCount || selectedPatchPanelPortCount < 1) && (
                  <p className="text-xs text-muted-foreground">Selected patch panel has no configured port count.</p>
                )}
                {errors.patch_panel_port && (
                  <p className="text-sm text-destructive">{errors.patch_panel_port.message}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {label ? 'Updating...' : 'Creating Label/s'}
              </>
            ) : (
              label ? 'Update Label' : 'Create Label'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default LabelForm;