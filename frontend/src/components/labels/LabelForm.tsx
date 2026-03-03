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

const optionalPositiveInt = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isNaN(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return Math.trunc(parsed);
}, z.number().int().positive().optional());

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
  patch_panel_sid_id: optionalPositiveInt,
  patch_panel_port: optionalPositiveInt,
  source_patch_panel_sid_id: optionalPositiveInt,
  source_patch_panel_port: optionalPositiveInt,
  destination_patch_panel_sid_id: optionalPositiveInt,
  destination_patch_panel_port: optionalPositiveInt,
  use_connected_endpoints: z.boolean().optional(),
  source_connected_sid_id: optionalPositiveInt,
  source_connected_port: z.string().max(255, 'Source port must be 255 characters or less').optional().or(z.literal('')),
  destination_connected_sid_id: optionalPositiveInt,
  destination_connected_port: z.string().max(255, 'Destination port must be 255 characters or less').optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  if (data.via_patch_panel) {
    const sourceSid = Number(data.source_patch_panel_sid_id ?? data.patch_panel_sid_id ?? 0);
    const sourcePort = Number(data.source_patch_panel_port ?? data.patch_panel_port ?? 0);
    const destinationSid = Number(data.destination_patch_panel_sid_id ?? 0);
    const destinationPort = Number(data.destination_patch_panel_port ?? 0);

    const sourceHasSid = Number.isFinite(sourceSid) && sourceSid > 0;
    const sourceHasPort = Number.isFinite(sourcePort) && sourcePort > 0;
    const destinationHasSid = Number.isFinite(destinationSid) && destinationSid > 0;
    const destinationHasPort = Number.isFinite(destinationPort) && destinationPort > 0;

    if ((sourceHasSid && !sourceHasPort) || (!sourceHasSid && sourceHasPort)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_patch_panel_port'],
        message: 'Source patch panel SID and port must both be set',
      });
    }
    if ((destinationHasSid && !destinationHasPort) || (!destinationHasSid && destinationHasPort)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_patch_panel_port'],
        message: 'Destination patch panel SID and port must both be set',
      });
    }
    if (!sourceHasSid && !destinationHasSid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_patch_panel_sid_id'],
        message: 'At least one patch panel is required when enabled',
      });
    }
  }

  if (data.use_connected_endpoints) {
    const sourceHasSid = Number.isFinite(Number(data.source_connected_sid_id)) && Number(data.source_connected_sid_id) > 0;
    const sourceHasPort = String(data.source_connected_port ?? '').trim() !== '';
    if (sourceHasSid && !sourceHasPort) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_connected_port'],
        message: 'Source connected port is required when source SID is set',
      });
    }
    if (!sourceHasSid && sourceHasPort) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_connected_sid_id'],
        message: 'Source connected SID is required when source connected port is set',
      });
    }

    const destinationHasSid = Number.isFinite(Number(data.destination_connected_sid_id)) && Number(data.destination_connected_sid_id) > 0;
    const destinationHasPort = String(data.destination_connected_port ?? '').trim() !== '';
    if (destinationHasSid && !destinationHasPort) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_connected_port'],
        message: 'Destination connected port is required when destination SID is set',
      });
    }
    if (!destinationHasSid && destinationHasPort) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_connected_sid_id'],
        message: 'Destination connected SID is required when destination connected port is set',
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
  const [siteSids, setSiteSids] = useState<Array<{ id: number; sid_number: string; hostname: string }>>([]);
  const [endpointPortOptionsBySid, setEndpointPortOptionsBySid] = useState<Record<number, string[]>>({});
  const [endpointPortLoadingBySid, setEndpointPortLoadingBySid] = useState<Record<number, boolean>>({});
  const [endpointPortErrorBySid, setEndpointPortErrorBySid] = useState<Record<number, string>>({});
  const [patchPanelSids, setPatchPanelSids] = useState<Array<{ id: number; sid_number: string; hostname: string; maxPorts: number | null }>>([]);
  const hasConnectedEndpointsDefault =
    (Number.isFinite(Number((label as any)?.source_connected_sid_id)) && Number((label as any)?.source_connected_sid_id) > 0) ||
    String((label as any)?.source_connected_port ?? '').trim() !== '' ||
    (Number.isFinite(Number((label as any)?.destination_connected_sid_id)) && Number((label as any)?.destination_connected_sid_id) > 0) ||
    String((label as any)?.destination_connected_port ?? '').trim() !== '';

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
      source_patch_panel_sid_id:
        Number.isFinite(Number((label as any)?.source_patch_panel_sid_id)) && Number((label as any)?.source_patch_panel_sid_id) > 0
          ? Number((label as any)?.source_patch_panel_sid_id)
          : (Number.isFinite(Number(label?.patch_panel_sid_id)) && Number(label?.patch_panel_sid_id) > 0 ? Number(label?.patch_panel_sid_id) : undefined),
      source_patch_panel_port:
        Number.isFinite(Number((label as any)?.source_patch_panel_port)) && Number((label as any)?.source_patch_panel_port) > 0
          ? Number((label as any)?.source_patch_panel_port)
          : (Number.isFinite(Number(label?.patch_panel_port)) && Number(label?.patch_panel_port) > 0 ? Number(label?.patch_panel_port) : undefined),
      destination_patch_panel_sid_id:
        Number.isFinite(Number((label as any)?.destination_patch_panel_sid_id)) && Number((label as any)?.destination_patch_panel_sid_id) > 0
          ? Number((label as any)?.destination_patch_panel_sid_id)
          : undefined,
      destination_patch_panel_port:
        Number.isFinite(Number((label as any)?.destination_patch_panel_port)) && Number((label as any)?.destination_patch_panel_port) > 0
          ? Number((label as any)?.destination_patch_panel_port)
          : undefined,
      use_connected_endpoints: Boolean(hasConnectedEndpointsDefault),
      source_connected_sid_id:
        Number.isFinite(Number((label as any)?.source_connected_sid_id)) && Number((label as any)?.source_connected_sid_id) > 0
          ? Number((label as any)?.source_connected_sid_id)
          : undefined,
      source_connected_port: String((label as any)?.source_connected_port ?? ''),
      destination_connected_sid_id:
        Number.isFinite(Number((label as any)?.destination_connected_sid_id)) && Number((label as any)?.destination_connected_sid_id) > 0
          ? Number((label as any)?.destination_connected_sid_id)
          : undefined,
      destination_connected_port: String((label as any)?.destination_connected_port ?? ''),
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

        const allSids = (sidsResp.data.sids ?? [])
          .map((sid: any) => {
            const sidId = Number(sid?.id ?? 0);
            const sidNumber = String(sid?.sid_number ?? '').trim();
            const hostname = String(sid?.hostname ?? '').trim();
            if (!Number.isFinite(sidId) || sidId <= 0 || sidNumber === '') return null;
            return { id: sidId, sid_number: sidNumber, hostname };
          })
          .filter((item): item is { id: number; sid_number: string; hostname: string } => Boolean(item))
          .sort((a, b) => a.sid_number.localeCompare(b.sid_number, undefined, { numeric: true, sensitivity: 'base' }));

        setSiteSids(allSids);

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
  const useConnectedEndpoints = Boolean(watchedValues.use_connected_endpoints);
  const selectedSourcePatchPanelSidId = Number(watchedValues.source_patch_panel_sid_id ?? watchedValues.patch_panel_sid_id ?? 0);
  const selectedSourcePatchPanel = patchPanelSids.find((sid) => sid.id === selectedSourcePatchPanelSidId) ?? null;
  const selectedSourcePatchPanelPortCount = selectedSourcePatchPanel?.maxPorts ?? null;
  const selectedDestinationPatchPanelSidId = Number(watchedValues.destination_patch_panel_sid_id ?? 0);
  const selectedDestinationPatchPanel = patchPanelSids.find((sid) => sid.id === selectedDestinationPatchPanelSidId) ?? null;
  const selectedDestinationPatchPanelPortCount = selectedDestinationPatchPanel?.maxPorts ?? null;
  const sourceConnectedSidId = Number(watchedValues.source_connected_sid_id ?? 0);
  const destinationConnectedSidId = Number(watchedValues.destination_connected_sid_id ?? 0);

  const normalizeNicPortLabel = React.useCallback((cardName: unknown, nicName: unknown): string => {
    const card = String(cardName ?? '').trim();
    const nic = String(nicName ?? '').trim();
    if (card && nic) return `${card} / ${nic}`;
    if (nic) return nic;
    if (card) return card;
    return '';
  }, []);

  const loadEndpointPortOptions = React.useCallback(async (sidId: number) => {
    if (!Number.isFinite(sidId) || sidId <= 0) return;
    if (endpointPortOptionsBySid[sidId] || endpointPortLoadingBySid[sidId]) return;

    setEndpointPortLoadingBySid((prev) => ({ ...prev, [sidId]: true }));
    setEndpointPortErrorBySid((prev) => {
      const next = { ...prev };
      delete next[sidId];
      return next;
    });

    try {
      const siteId = Number(getValues('site_id'));
      if (!Number.isFinite(siteId) || siteId <= 0) {
        throw new Error('Invalid site context for endpoint lookup');
      }

      const sidResp = await apiClient.getSiteSid(siteId, sidId, { log_view: false });
      if (!sidResp.success || !sidResp.data?.sid) {
        throw new Error(sidResp.error || 'Failed to load SID endpoint details');
      }

      const sid = sidResp.data.sid as any;
      const isSwitch = Number(sid?.device_model_is_switch ?? 0) === 1 || sid?.device_model_is_switch === true;

      let options: string[] = [];
      if (isSwitch) {
        const sidPortCountRaw = Number(sid?.switch_port_count ?? 0);
        const defaultPortCountRaw = Number(sid?.device_model_default_switch_port_count ?? 0);
        const maxPorts = Number.isFinite(sidPortCountRaw) && sidPortCountRaw > 0
          ? Math.floor(sidPortCountRaw)
          : (Number.isFinite(defaultPortCountRaw) && defaultPortCountRaw > 0 ? Math.floor(defaultPortCountRaw) : 0);

        if (maxPorts > 0) {
          options = Array.from({ length: maxPorts }, (_, index) => String(index + 1));
        }
      } else {
        const unique = new Set<string>();
        for (const nic of sidResp.data.nics ?? []) {
          const label = normalizeNicPortLabel((nic as any)?.card_name, (nic as any)?.name);
          if (label) unique.add(label);
        }
        options = Array.from(unique.values());
      }

      if (options.length === 0) {
        throw new Error('Selected SID has no available ports');
      }

      setEndpointPortOptionsBySid((prev) => ({
        ...prev,
        [sidId]: options,
      }));
    } catch (err) {
      setEndpointPortErrorBySid((prev) => ({
        ...prev,
        [sidId]: err instanceof Error ? err.message : 'Failed to load endpoint ports',
      }));
      setEndpointPortOptionsBySid((prev) => ({
        ...prev,
        [sidId]: [],
      }));
    } finally {
      setEndpointPortLoadingBySid((prev) => ({ ...prev, [sidId]: false }));
    }
  }, [endpointPortLoadingBySid, endpointPortOptionsBySid, getValues, normalizeNicPortLabel]);

  useEffect(() => {
    if (!viaPatchPanel) {
      setValue('patch_panel_sid_id', undefined, { shouldValidate: true });
      setValue('patch_panel_port', undefined, { shouldValidate: true });
      setValue('source_patch_panel_sid_id', undefined, { shouldValidate: true });
      setValue('source_patch_panel_port', undefined, { shouldValidate: true });
      setValue('destination_patch_panel_sid_id', undefined, { shouldValidate: true });
      setValue('destination_patch_panel_port', undefined, { shouldValidate: true });
      return;
    }

    if (!selectedSourcePatchPanel) {
      setValue('source_patch_panel_port', undefined, { shouldValidate: true });
      setValue('patch_panel_port', undefined, { shouldValidate: true });
    } else {
      const currentSourcePort = Number(watchedValues.source_patch_panel_port ?? watchedValues.patch_panel_port ?? 0);
      if (selectedSourcePatchPanelPortCount && selectedSourcePatchPanelPortCount > 0) {
        if (!Number.isFinite(currentSourcePort) || currentSourcePort < 1 || currentSourcePort > selectedSourcePatchPanelPortCount) {
          setValue('source_patch_panel_port', 1, { shouldValidate: true });
          setValue('patch_panel_port', 1, { shouldValidate: true });
        }
      }
    }

    if (!selectedDestinationPatchPanel) {
      setValue('destination_patch_panel_port', undefined, { shouldValidate: true });
    } else {
      const currentDestinationPort = Number(watchedValues.destination_patch_panel_port ?? 0);
      if (selectedDestinationPatchPanelPortCount && selectedDestinationPatchPanelPortCount > 0) {
        if (!Number.isFinite(currentDestinationPort) || currentDestinationPort < 1 || currentDestinationPort > selectedDestinationPatchPanelPortCount) {
          setValue('destination_patch_panel_port', 1, { shouldValidate: true });
        }
      }
    }
  }, [
    viaPatchPanel,
    selectedSourcePatchPanel,
    selectedSourcePatchPanelPortCount,
    watchedValues.source_patch_panel_port,
    watchedValues.patch_panel_port,
    selectedDestinationPatchPanel,
    selectedDestinationPatchPanelPortCount,
    watchedValues.destination_patch_panel_port,
    setValue,
  ]);

  useEffect(() => {
    if (!useConnectedEndpoints) {
      setValue('source_connected_sid_id', undefined, { shouldValidate: true });
      setValue('source_connected_port', '', { shouldValidate: true });
      setValue('destination_connected_sid_id', undefined, { shouldValidate: true });
      setValue('destination_connected_port', '', { shouldValidate: true });
    }
  }, [setValue, useConnectedEndpoints]);

  useEffect(() => {
    if (!useConnectedEndpoints) return;
    if (sourceConnectedSidId > 0) {
      void loadEndpointPortOptions(sourceConnectedSidId);
      return;
    }
    setValue('source_connected_port', '', { shouldValidate: true });
  }, [loadEndpointPortOptions, setValue, sourceConnectedSidId, useConnectedEndpoints]);

  useEffect(() => {
    if (!useConnectedEndpoints) return;
    if (destinationConnectedSidId > 0) {
      void loadEndpointPortOptions(destinationConnectedSidId);
      return;
    }
    setValue('destination_connected_port', '', { shouldValidate: true });
  }, [destinationConnectedSidId, loadEndpointPortOptions, setValue, useConnectedEndpoints]);

  const sourcePortOptions = sourceConnectedSidId > 0 ? (endpointPortOptionsBySid[sourceConnectedSidId] ?? []) : [];
  const sourcePortLoading = sourceConnectedSidId > 0 ? Boolean(endpointPortLoadingBySid[sourceConnectedSidId]) : false;
  const sourcePortError = sourceConnectedSidId > 0 ? endpointPortErrorBySid[sourceConnectedSidId] : undefined;

  const destinationPortOptions = destinationConnectedSidId > 0 ? (endpointPortOptionsBySid[destinationConnectedSidId] ?? []) : [];
  const destinationPortLoading = destinationConnectedSidId > 0 ? Boolean(endpointPortLoadingBySid[destinationConnectedSidId]) : false;
  const destinationPortError = destinationConnectedSidId > 0 ? endpointPortErrorBySid[destinationConnectedSidId] : undefined;

  useEffect(() => {
    if (sourceConnectedSidId <= 0) return;
    const currentPort = String(watchedValues.source_connected_port ?? '').trim();
    if (!currentPort) return;
    const sourceOptionsLoaded = Object.prototype.hasOwnProperty.call(endpointPortOptionsBySid, sourceConnectedSidId);
    if (!sourceOptionsLoaded) return;
    if (!sourcePortOptions.includes(currentPort)) {
      setValue('source_connected_port', '', { shouldValidate: true });
    }
  }, [endpointPortOptionsBySid, setValue, sourceConnectedSidId, sourcePortOptions, watchedValues.source_connected_port]);

  useEffect(() => {
    if (destinationConnectedSidId <= 0) return;
    const currentPort = String(watchedValues.destination_connected_port ?? '').trim();
    if (!currentPort) return;
    const destinationOptionsLoaded = Object.prototype.hasOwnProperty.call(endpointPortOptionsBySid, destinationConnectedSidId);
    if (!destinationOptionsLoaded) return;
    if (!destinationPortOptions.includes(currentPort)) {
      setValue('destination_connected_port', '', { shouldValidate: true });
    }
  }, [destinationConnectedSidId, destinationPortOptions, endpointPortOptionsBySid, setValue, watchedValues.destination_connected_port]);

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
        ...(data.via_patch_panel && Number.isFinite(Number(data.source_patch_panel_sid_id)) && Number(data.source_patch_panel_sid_id) > 0
          ? { source_patch_panel_sid_id: Number(data.source_patch_panel_sid_id), patch_panel_sid_id: Number(data.source_patch_panel_sid_id) }
          : {}),
        ...(data.via_patch_panel && Number.isFinite(Number(data.source_patch_panel_port)) && Number(data.source_patch_panel_port) > 0
          ? { source_patch_panel_port: Number(data.source_patch_panel_port), patch_panel_port: Number(data.source_patch_panel_port) }
          : {}),
        ...(data.via_patch_panel && Number.isFinite(Number(data.destination_patch_panel_sid_id)) && Number(data.destination_patch_panel_sid_id) > 0
          ? { destination_patch_panel_sid_id: Number(data.destination_patch_panel_sid_id) }
          : {}),
        ...(data.via_patch_panel && Number.isFinite(Number(data.destination_patch_panel_port)) && Number(data.destination_patch_panel_port) > 0
          ? { destination_patch_panel_port: Number(data.destination_patch_panel_port) }
          : {}),
        ...(data.use_connected_endpoints && Number.isFinite(Number(data.source_connected_sid_id)) && Number(data.source_connected_sid_id) > 0
          ? { source_connected_sid_id: Number(data.source_connected_sid_id) }
          : {}),
        ...(data.use_connected_endpoints && String(data.source_connected_port ?? '').trim() !== ''
          ? { source_connected_port: String(data.source_connected_port).trim() }
          : {}),
        ...(data.use_connected_endpoints && Number.isFinite(Number(data.destination_connected_sid_id)) && Number(data.destination_connected_sid_id) > 0
          ? { destination_connected_sid_id: Number(data.destination_connected_sid_id) }
          : {}),
        ...(data.use_connected_endpoints && String(data.destination_connected_port ?? '').trim() !== ''
          ? { destination_connected_port: String(data.destination_connected_port).trim() }
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
        <input type="hidden" {...register('use_connected_endpoints')} />

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
          <div>
            <Label>Optional Connected Endpoints</Label>
            <p className="text-xs text-muted-foreground">Optionally select a SID and then choose a valid port for each end of the cable.</p>
          </div>

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="use_connected_endpoints">Use Optional Connected Endpoints?</Label>
                <p className="text-xs text-muted-foreground">Enable to define source and destination connected SID/port metadata.</p>
              </div>
              <Switch
                id="use_connected_endpoints"
                checked={useConnectedEndpoints}
                onCheckedChange={(checked) => setValue('use_connected_endpoints', Boolean(checked), { shouldValidate: true })}
                disabled={isLoading}
                aria-label="Use Optional Connected Endpoints?"
              />
            </div>
          </div>

          {useConnectedEndpoints && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm font-medium">Source Endpoint</div>

              <div className="space-y-2">
                <Label htmlFor="source_connected_sid_id">Source Connected SID</Label>
                <input type="hidden" {...register('source_connected_sid_id', { valueAsNumber: true })} />
                <Select
                  value={Number.isFinite(Number(watchedValues.source_connected_sid_id)) && Number(watchedValues.source_connected_sid_id) > 0
                    ? String(Number(watchedValues.source_connected_sid_id))
                    : 'none'}
                  onValueChange={(value) => {
                    setValue('source_connected_sid_id', value === 'none' ? undefined : Number(value), { shouldValidate: true });
                    setValue('source_connected_port', '', { shouldValidate: true });
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger id="source_connected_sid_id">
                    <SelectValue placeholder="Optional SID" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {siteSids.map((sid) => (
                      <SelectItem key={`src-${sid.id}`} value={String(sid.id)}>
                        {sid.sid_number}{sid.hostname ? ` — ${sid.hostname}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.source_connected_sid_id && <p className="text-sm text-destructive">{errors.source_connected_sid_id.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="source_connected_port">Source Connected Port</Label>
                <Select
                  value={String(watchedValues.source_connected_port ?? '').trim() || 'none'}
                  onValueChange={(value) => setValue('source_connected_port', value === 'none' ? '' : value, { shouldValidate: true })}
                  disabled={isLoading || sourceConnectedSidId <= 0 || sourcePortLoading || sourcePortOptions.length === 0}
                >
                  <SelectTrigger id="source_connected_port">
                    <SelectValue placeholder={sourceConnectedSidId > 0 ? 'Select source port' : 'Select source SID first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {sourcePortOptions.map((port) => (
                      <SelectItem key={`src-port-${port}`} value={port}>
                        {port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sourcePortLoading && <p className="text-xs text-muted-foreground">Loading source SID ports…</p>}
                {sourcePortError && <p className="text-xs text-destructive">{sourcePortError}</p>}
                {errors.source_connected_port && <p className="text-sm text-destructive">{errors.source_connected_port.message}</p>}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Destination Endpoint</div>

              <div className="space-y-2">
                <Label htmlFor="destination_connected_sid_id">Destination Connected SID</Label>
                <input type="hidden" {...register('destination_connected_sid_id', { valueAsNumber: true })} />
                <Select
                  value={Number.isFinite(Number(watchedValues.destination_connected_sid_id)) && Number(watchedValues.destination_connected_sid_id) > 0
                    ? String(Number(watchedValues.destination_connected_sid_id))
                    : 'none'}
                  onValueChange={(value) => {
                    setValue('destination_connected_sid_id', value === 'none' ? undefined : Number(value), { shouldValidate: true });
                    setValue('destination_connected_port', '', { shouldValidate: true });
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger id="destination_connected_sid_id">
                    <SelectValue placeholder="Optional SID" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {siteSids.map((sid) => (
                      <SelectItem key={`dst-${sid.id}`} value={String(sid.id)}>
                        {sid.sid_number}{sid.hostname ? ` — ${sid.hostname}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.destination_connected_sid_id && <p className="text-sm text-destructive">{errors.destination_connected_sid_id.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="destination_connected_port">Destination Connected Port</Label>
                <Select
                  value={String(watchedValues.destination_connected_port ?? '').trim() || 'none'}
                  onValueChange={(value) => setValue('destination_connected_port', value === 'none' ? '' : value, { shouldValidate: true })}
                  disabled={isLoading || destinationConnectedSidId <= 0 || destinationPortLoading || destinationPortOptions.length === 0}
                >
                  <SelectTrigger id="destination_connected_port">
                    <SelectValue placeholder={destinationConnectedSidId > 0 ? 'Select destination port' : 'Select destination SID first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {destinationPortOptions.map((port) => (
                      <SelectItem key={`dst-port-${port}`} value={port}>
                        {port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {destinationPortLoading && <p className="text-xs text-muted-foreground">Loading destination SID ports…</p>}
                {destinationPortError && <p className="text-xs text-destructive">{destinationPortError}</p>}
                {errors.destination_connected_port && <p className="text-sm text-destructive">{errors.destination_connected_port.message}</p>}
              </div>
            </div>
          </div>
          )}

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="via_patch_panel">Does the cable run via Patch Panel/s?</Label>
                <p className="text-xs text-muted-foreground">Enable to attach this cable run to a patch panel and port.</p>
              </div>
              <Switch
                id="via_patch_panel"
                checked={viaPatchPanel}
                onCheckedChange={(checked) => setValue('via_patch_panel', Boolean(checked), { shouldValidate: true })}
                disabled={isLoading}
                aria-label="Does the cable run via Patch Panel/s?"
              />
            </div>

            {viaPatchPanel && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="source_patch_panel_sid_id">Source Patch Panel</Label>
                    <input type="hidden" {...register('source_patch_panel_sid_id', { valueAsNumber: true })} />
                    <input type="hidden" {...register('patch_panel_sid_id', { valueAsNumber: true })} />
                    <Select
                      value={selectedSourcePatchPanelSidId > 0 ? String(selectedSourcePatchPanelSidId) : ''}
                      onValueChange={(value) => {
                        const parsed = Number(value);
                        setValue('source_patch_panel_sid_id', parsed, { shouldValidate: true });
                        setValue('patch_panel_sid_id', parsed, { shouldValidate: true });
                        setValue('source_patch_panel_port', undefined, { shouldValidate: true });
                        setValue('patch_panel_port', undefined, { shouldValidate: true });
                      }}
                      disabled={isLoading || patchPanelSids.length === 0}
                    >
                      <SelectTrigger id="source_patch_panel_sid_id">
                        <SelectValue placeholder={patchPanelSids.length ? 'Select source patch panel SID' : 'No patch panel SIDs available'} />
                      </SelectTrigger>
                      <SelectContent>
                        {patchPanelSids.map((sid) => (
                          <SelectItem key={`src-pp-${sid.id}`} value={String(sid.id)}>
                            {sid.sid_number}
                            {sid.hostname ? ` — ${sid.hostname}` : ''}
                            {sid.maxPorts ? ` (${sid.maxPorts} ports)` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.source_patch_panel_sid_id && (
                      <p className="text-sm text-destructive">{errors.source_patch_panel_sid_id.message}</p>
                    )}
                    {errors.patch_panel_sid_id && (
                      <p className="text-sm text-destructive">{errors.patch_panel_sid_id.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="source_patch_panel_port">Source Patch Panel Port</Label>
                    <input type="hidden" {...register('source_patch_panel_port', { valueAsNumber: true })} />
                    <input type="hidden" {...register('patch_panel_port', { valueAsNumber: true })} />
                    <Select
                      value={Number.isFinite(Number(watchedValues.source_patch_panel_port ?? watchedValues.patch_panel_port)) && Number(watchedValues.source_patch_panel_port ?? watchedValues.patch_panel_port) > 0
                        ? String(Number(watchedValues.source_patch_panel_port ?? watchedValues.patch_panel_port))
                        : ''}
                      onValueChange={(value) => {
                        const parsed = Number(value);
                        setValue('source_patch_panel_port', parsed, { shouldValidate: true });
                        setValue('patch_panel_port', parsed, { shouldValidate: true });
                      }}
                      disabled={
                        isLoading ||
                        !selectedSourcePatchPanel ||
                        !selectedSourcePatchPanelPortCount ||
                        selectedSourcePatchPanelPortCount < 1
                      }
                    >
                      <SelectTrigger id="source_patch_panel_port">
                        <SelectValue placeholder="Select source patch panel port" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedSourcePatchPanelPortCount && selectedSourcePatchPanelPortCount > 0
                          ? Array.from({ length: selectedSourcePatchPanelPortCount }, (_, index) => index + 1).map((port) => (
                              <SelectItem key={`src-pp-port-${port}`} value={String(port)}>
                                Port {port}
                              </SelectItem>
                            ))
                          : null}
                      </SelectContent>
                    </Select>
                    {selectedSourcePatchPanel && (!selectedSourcePatchPanelPortCount || selectedSourcePatchPanelPortCount < 1) && (
                      <p className="text-xs text-muted-foreground">Selected source patch panel has no configured port count.</p>
                    )}
                    {errors.source_patch_panel_port && (
                      <p className="text-sm text-destructive">{errors.source_patch_panel_port.message}</p>
                    )}
                    {errors.patch_panel_port && (
                      <p className="text-sm text-destructive">{errors.patch_panel_port.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="destination_patch_panel_sid_id">Destination Patch Panel</Label>
                    <input type="hidden" {...register('destination_patch_panel_sid_id', { valueAsNumber: true })} />
                    <Select
                      value={selectedDestinationPatchPanelSidId > 0 ? String(selectedDestinationPatchPanelSidId) : ''}
                      onValueChange={(value) => {
                        setValue('destination_patch_panel_sid_id', Number(value), { shouldValidate: true });
                        setValue('destination_patch_panel_port', undefined, { shouldValidate: true });
                      }}
                      disabled={isLoading || patchPanelSids.length === 0}
                    >
                      <SelectTrigger id="destination_patch_panel_sid_id">
                        <SelectValue placeholder={patchPanelSids.length ? 'Select destination patch panel SID' : 'No patch panel SIDs available'} />
                      </SelectTrigger>
                      <SelectContent>
                        {patchPanelSids.map((sid) => (
                          <SelectItem key={`dst-pp-${sid.id}`} value={String(sid.id)}>
                            {sid.sid_number}
                            {sid.hostname ? ` — ${sid.hostname}` : ''}
                            {sid.maxPorts ? ` (${sid.maxPorts} ports)` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.destination_patch_panel_sid_id && (
                      <p className="text-sm text-destructive">{errors.destination_patch_panel_sid_id.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="destination_patch_panel_port">Destination Patch Panel Port</Label>
                    <input type="hidden" {...register('destination_patch_panel_port', { valueAsNumber: true })} />
                    <Select
                      value={Number.isFinite(Number(watchedValues.destination_patch_panel_port)) && Number(watchedValues.destination_patch_panel_port) > 0
                        ? String(Number(watchedValues.destination_patch_panel_port))
                        : ''}
                      onValueChange={(value) => setValue('destination_patch_panel_port', Number(value), { shouldValidate: true })}
                      disabled={
                        isLoading ||
                        !selectedDestinationPatchPanel ||
                        !selectedDestinationPatchPanelPortCount ||
                        selectedDestinationPatchPanelPortCount < 1
                      }
                    >
                      <SelectTrigger id="destination_patch_panel_port">
                        <SelectValue placeholder="Select destination patch panel port" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedDestinationPatchPanelPortCount && selectedDestinationPatchPanelPortCount > 0
                          ? Array.from({ length: selectedDestinationPatchPanelPortCount }, (_, index) => index + 1).map((port) => (
                              <SelectItem key={`dst-pp-port-${port}`} value={String(port)}>
                                Port {port}
                              </SelectItem>
                            ))
                          : null}
                      </SelectContent>
                    </Select>
                    {selectedDestinationPatchPanel && (!selectedDestinationPatchPanelPortCount || selectedDestinationPatchPanelPortCount < 1) && (
                      <p className="text-xs text-muted-foreground">Selected destination patch panel has no configured port count.</p>
                    )}
                    {errors.destination_patch_panel_port && (
                      <p className="text-sm text-destructive">{errors.destination_patch_panel_port.message}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
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