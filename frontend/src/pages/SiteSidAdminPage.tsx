import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';

import { apiClient } from '../lib/api';
import usePermissions from '../hooks/usePermissions';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Switch } from '../components/ui/switch';
import SiteLocationsManager from '../components/sites/SiteLocationsManager';

type PicklistKind =
  | 'sidType'
  | 'deviceModel'
  | 'cpuModel'
  | 'platform'
  | 'status'
  | 'passwordType'
  | 'vlan'
  | 'nicType'
  | 'nicSpeed';

const SiteSidAdminPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const siteId = Number(params.siteId);
  const permissions = usePermissions();
  const canAdmin = permissions.canAdministerSite(siteId);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [siteName, setSiteName] = React.useState<string | null>(null);
  const [siteCode, setSiteCode] = React.useState<string | null>(null);

  const [sidTypes, setSidTypes] = React.useState<any[]>([]);
  const [deviceModels, setDeviceModels] = React.useState<any[]>([]);
  const [cpuModels, setCpuModels] = React.useState<any[]>([]);
  const [platforms, setPlatforms] = React.useState<any[]>([]);
  const [statuses, setStatuses] = React.useState<any[]>([]);
  const [passwordTypes, setPasswordTypes] = React.useState<any[]>([]);
  const [vlans, setVlans] = React.useState<any[]>([]);
  const [nicTypes, setNicTypes] = React.useState<any[]>([]);
  const [nicSpeeds, setNicSpeeds] = React.useState<any[]>([]);

  const [busy, setBusy] = React.useState(false);
  const [opError, setOpError] = React.useState<string | null>(null);

  const [addDialog, setAddDialog] = React.useState<null | PicklistKind>(null);

  const [editDialog, setEditDialog] = React.useState<null | PicklistKind>(null);
  const [editRowId, setEditRowId] = React.useState<number | null>(null);
  const [pendingUpdate, setPendingUpdate] = React.useState<null | { kind: PicklistKind; rowId: number; payload: any; usageCount: number }>(null);
  const [pendingDelete, setPendingDelete] = React.useState<null | { kind: PicklistKind; rowId: number; label: string; usageCount: number }>(null);

  const [newTypeName, setNewTypeName] = React.useState('');
  const [newDeviceManufacturer, setNewDeviceManufacturer] = React.useState('');
  const [newDeviceName, setNewDeviceName] = React.useState('');
  const [newDeviceRackU, setNewDeviceRackU] = React.useState('');
  const [newDeviceIsSwitch, setNewDeviceIsSwitch] = React.useState(false);
  const [newDeviceDefaultSwitchPortCount, setNewDeviceDefaultSwitchPortCount] = React.useState('');
  const [newDeviceIsPatchPanel, setNewDeviceIsPatchPanel] = React.useState(false);
  const [newDeviceDefaultPatchPanelPortCount, setNewDeviceDefaultPatchPanelPortCount] = React.useState('');
  const [newCpuManufacturer, setNewCpuManufacturer] = React.useState('');
  const [newCpuName, setNewCpuName] = React.useState('');
  const [newCpuCores, setNewCpuCores] = React.useState('');
  const [newCpuThreads, setNewCpuThreads] = React.useState('');
  const [newPlatformName, setNewPlatformName] = React.useState('');
  const [newStatusName, setNewStatusName] = React.useState('');
  const [newPasswordTypeName, setNewPasswordTypeName] = React.useState('');
  const [newVlanId, setNewVlanId] = React.useState('');
  const [newVlanName, setNewVlanName] = React.useState('');
  const [newNicTypeName, setNewNicTypeName] = React.useState('');
  const [newNicSpeedName, setNewNicSpeedName] = React.useState('');

  const [editTypeName, setEditTypeName] = React.useState('');
  const [editDeviceManufacturer, setEditDeviceManufacturer] = React.useState('');
  const [editDeviceName, setEditDeviceName] = React.useState('');
  const [editDeviceRackU, setEditDeviceRackU] = React.useState('');
  const [editDeviceIsSwitch, setEditDeviceIsSwitch] = React.useState(false);
  const [editDeviceDefaultSwitchPortCount, setEditDeviceDefaultSwitchPortCount] = React.useState('');
  const [editDeviceIsPatchPanel, setEditDeviceIsPatchPanel] = React.useState(false);
  const [editDeviceDefaultPatchPanelPortCount, setEditDeviceDefaultPatchPanelPortCount] = React.useState('');
  const [editCpuManufacturer, setEditCpuManufacturer] = React.useState('');
  const [editCpuName, setEditCpuName] = React.useState('');
  const [editCpuCores, setEditCpuCores] = React.useState('');
  const [editCpuThreads, setEditCpuThreads] = React.useState('');
  const [editPlatformName, setEditPlatformName] = React.useState('');
  const [editStatusName, setEditStatusName] = React.useState('');
  const [editPasswordTypeName, setEditPasswordTypeName] = React.useState('');
  const [editVlanId, setEditVlanId] = React.useState('');
  const [editVlanName, setEditVlanName] = React.useState('');
  const [editNicTypeName, setEditNicTypeName] = React.useState('');
  const [editNicSpeedName, setEditNicSpeedName] = React.useState('');

  const [activeTab, setActiveTab] = React.useState<
    'types' | 'devices' | 'cpus' | 'platforms' | 'statuses' | 'locations' | 'passwordTypes' | 'vlans' | 'nicTypes' | 'nicSpeeds'
  >('types');

  const visibleStatuses = React.useMemo(
    () => (statuses ?? []).filter((s) => String(s?.name ?? '').trim().toLowerCase() !== 'deleted'),
    [statuses]
  );

  React.useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    const allowed = new Set(['types', 'devices', 'cpus', 'platforms', 'statuses', 'locations', 'passwordTypes', 'vlans', 'nicTypes', 'nicSpeeds']);
    if (tab && allowed.has(tab)) {
      setActiveTab(tab as any);
    }
  }, [location.search]);

  const closeAddDialog = () => {
    setAddDialog(null);
    setOpError(null);
  };

  const closeEditDialog = () => {
    setEditDialog(null);
    setEditRowId(null);
    setOpError(null);
  };

  const openEditDialog = (kind: PicklistKind, row: any) => {
    setOpError(null);
    setEditDialog(kind);
    setEditRowId(Number(row.id));

    if (kind === 'sidType') {
      setEditTypeName(String(row.name ?? ''));
    } else if (kind === 'deviceModel') {
      setEditDeviceManufacturer(String(row.manufacturer ?? ''));
      setEditDeviceName(String(row.name ?? ''));
      setEditDeviceRackU(row.rack_u != null ? String(row.rack_u) : '');
      setEditDeviceIsSwitch(Boolean(row.is_switch));
      setEditDeviceDefaultSwitchPortCount(
        row.default_switch_port_count != null ? String(row.default_switch_port_count) : ''
      );
      setEditDeviceIsPatchPanel(Boolean(row.is_patch_panel));
      setEditDeviceDefaultPatchPanelPortCount(
        row.default_patch_panel_port_count != null ? String(row.default_patch_panel_port_count) : ''
      );
    } else if (kind === 'cpuModel') {
      setEditCpuManufacturer(String(row.manufacturer ?? ''));
      setEditCpuName(String(row.name ?? ''));
      setEditCpuCores(row.cpu_cores != null ? String(row.cpu_cores) : '');
      setEditCpuThreads(row.cpu_threads != null ? String(row.cpu_threads) : '');
    } else if (kind === 'platform') {
      setEditPlatformName(String(row.name ?? ''));
    } else if (kind === 'status') {
      setEditStatusName(String(row.name ?? ''));
    } else if (kind === 'passwordType') {
      setEditPasswordTypeName(String(row.name ?? ''));
    } else if (kind === 'vlan') {
      setEditVlanId(row.vlan_id != null ? String(row.vlan_id) : '');
      setEditVlanName(String(row.name ?? ''));
    } else if (kind === 'nicType') {
      setEditNicTypeName(String(row.name ?? ''));
    } else if (kind === 'nicSpeed') {
      setEditNicSpeedName(String(row.name ?? ''));
    }
  };

  const load = React.useCallback(async () => {
    if (!Number.isFinite(siteId) || siteId <= 0) {
      setError('Invalid site');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [siteResp, typesResp, dmResp, cpuResp, platformResp, statusesResp, passwordTypesResp, vlanResp, nicTypesResp, nicSpeedsResp] = await Promise.all([
        apiClient.getSite(siteId),
        apiClient.getSiteSidTypes(siteId),
        apiClient.getSiteSidDeviceModels(siteId),
        apiClient.getSiteSidCpuModels(siteId),
        apiClient.getSiteSidPlatforms(siteId),
        apiClient.getSiteSidStatuses(siteId),
        apiClient.getSiteSidPasswordTypes(siteId),
        apiClient.getSiteSidVlans(siteId),
        apiClient.getSiteSidNicTypes(siteId),
        apiClient.getSiteSidNicSpeeds(siteId),
      ]);

      if (!siteResp.success || !siteResp.data?.site) {
        throw new Error(siteResp.error || 'Failed to load site');
      }
      setSiteName(siteResp.data.site.name ?? null);
      setSiteCode(siteResp.data.site.code ?? null);

      setSidTypes(typesResp.success ? (typesResp.data?.sid_types ?? []) : []);
      setDeviceModels(dmResp.success ? (dmResp.data?.device_models ?? []) : []);
      setCpuModels(cpuResp.success ? (cpuResp.data?.cpu_models ?? []) : []);
      setPlatforms(platformResp.success ? (platformResp.data?.platforms ?? []) : []);
      setStatuses(statusesResp.success ? (statusesResp.data?.statuses ?? []) : []);
      setPasswordTypes(passwordTypesResp.success ? (passwordTypesResp.data?.password_types ?? []) : []);
      setVlans(vlanResp.success ? (vlanResp.data?.vlans ?? []) : []);
      setNicTypes(nicTypesResp.success ? (nicTypesResp.data?.nic_types ?? []) : []);
      setNicSpeeds(nicSpeedsResp.success ? (nicSpeedsResp.data?.nic_speeds ?? []) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const requireAdmin = (): boolean => {
    if (!canAdmin) {
      setOpError('Site admin access required');
      return false;
    }
    return true;
  };

  const createType = async () => {
    if (!requireAdmin()) return;
    const name = newTypeName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidType(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create type');
      setNewTypeName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create type');
    } finally {
      setBusy(false);
    }
  };

  const deleteType = async (id: number, label: string) => {
    await requestPicklistDelete('sidType', id, label);
  };

  const createDeviceModel = async () => {
    if (!requireAdmin()) return;
    const name = newDeviceName.trim();
    const defaultPortCount = Number(newDeviceDefaultSwitchPortCount);
    const defaultPatchPanelPortCount = Number(newDeviceDefaultPatchPanelPortCount);
    const rackUText = newDeviceRackU.trim();
    const rackUNumber = Number(rackUText);
    if (!name) {
      setOpError('Name is required');
      return;
    }
    if (rackUText !== '' && (!Number.isFinite(rackUNumber) || !Number.isInteger(rackUNumber) || rackUNumber <= 0 || rackUNumber > 99)) {
      setOpError('Rack U must be a whole number between 1 and 99');
      return;
    }
    const rackU = rackUText === '' ? null : rackUNumber;
    if (newDeviceIsSwitch && (!Number.isFinite(defaultPortCount) || defaultPortCount <= 0 || defaultPortCount > 4096)) {
      setOpError('Switch port count must be 1-4096');
      return;
    }
    if (newDeviceIsPatchPanel && (!Number.isFinite(defaultPatchPanelPortCount) || defaultPatchPanelPortCount <= 0 || defaultPatchPanelPortCount > 4096)) {
      setOpError('Patch panel port count must be 1-4096');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidDeviceModel(siteId, {
        manufacturer: newDeviceManufacturer.trim() || null,
        name,
        rack_u: rackU,
        is_switch: newDeviceIsSwitch,
        default_switch_port_count: newDeviceIsSwitch ? defaultPortCount : null,
        is_patch_panel: newDeviceIsPatchPanel,
        default_patch_panel_port_count: newDeviceIsPatchPanel ? defaultPatchPanelPortCount : null,
      });
      if (!resp.success) throw new Error(resp.error || 'Failed to create device model');
      setNewDeviceManufacturer('');
      setNewDeviceName('');
      setNewDeviceRackU('');
      setNewDeviceIsSwitch(false);
      setNewDeviceDefaultSwitchPortCount('');
      setNewDeviceIsPatchPanel(false);
      setNewDeviceDefaultPatchPanelPortCount('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create device model');
    } finally {
      setBusy(false);
    }
  };

  const deleteDeviceModel = async (id: number, label: string) => {
    await requestPicklistDelete('deviceModel', id, label);
  };

  const createCpuModel = async () => {
    if (!requireAdmin()) return;
    const name = newCpuName.trim();
    const cpuCores = Number(newCpuCores);
    const cpuThreads = Number(newCpuThreads);
    if (!name) {
      setOpError('Name is required');
      return;
    }
    if (!Number.isFinite(cpuCores) || cpuCores <= 0) {
      setOpError('CPU cores must be a positive number');
      return;
    }
    if (!Number.isFinite(cpuThreads) || cpuThreads <= 0) {
      setOpError('CPU threads must be a positive number');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidCpuModel(siteId, {
        manufacturer: newCpuManufacturer.trim() || null,
        name,
        cpu_cores: cpuCores,
        cpu_threads: cpuThreads,
      });
      if (!resp.success) throw new Error(resp.error || 'Failed to create CPU model');
      setNewCpuManufacturer('');
      setNewCpuName('');
      setNewCpuCores('');
      setNewCpuThreads('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create CPU model');
    } finally {
      setBusy(false);
    }
  };

  const deleteCpuModel = async (id: number, label: string) => {
    await requestPicklistDelete('cpuModel', id, label);
  };

  const createPlatform = async () => {
    if (!requireAdmin()) return;
    const name = newPlatformName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidPlatform(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create platform');
      setNewPlatformName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create platform');
    } finally {
      setBusy(false);
    }
  };

  const createStatus = async () => {
    if (!requireAdmin()) return;
    const name = newStatusName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidStatus(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create status');
      setNewStatusName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create status');
    } finally {
      setBusy(false);
    }
  };

  const deleteStatus = async (id: number, label: string) => {
    await requestPicklistDelete('status', id, label);
  };

  const createPasswordType = async () => {
    if (!requireAdmin()) return;
    const name = newPasswordTypeName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidPasswordType(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create password type');
      setNewPasswordTypeName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create password type');
    } finally {
      setBusy(false);
    }
  };

  const deletePasswordType = async (id: number, label: string) => {
    await requestPicklistDelete('passwordType', id, label);
  };

  const deletePlatform = async (id: number, label: string) => {
    await requestPicklistDelete('platform', id, label);
  };

  const createVlan = async () => {
    if (!requireAdmin()) return;
    const vlanId = Number(newVlanId);
    const name = newVlanName.trim();
    if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) {
      setOpError('VLAN ID must be 1-4094');
      return;
    }
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidVlan(siteId, { vlan_id: vlanId, name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create VLAN');
      setNewVlanId('');
      setNewVlanName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create VLAN');
    } finally {
      setBusy(false);
    }
  };

  const deleteVlan = async (id: number, label: string) => {
    await requestPicklistDelete('vlan', id, label);
  };

  const createNicType = async () => {
    if (!requireAdmin()) return;
    const name = newNicTypeName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidNicType(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create NIC type');
      setNewNicTypeName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create NIC type');
    } finally {
      setBusy(false);
    }
  };

  const deleteNicType = async (id: number, label: string) => {
    await requestPicklistDelete('nicType', id, label);
  };

  const createNicSpeed = async () => {
    if (!requireAdmin()) return;
    const name = newNicSpeedName.trim();
    if (!name) {
      setOpError('Name is required');
      return;
    }

    try {
      setBusy(true);
      setOpError(null);
      const resp = await apiClient.createSiteSidNicSpeed(siteId, { name });
      if (!resp.success) throw new Error(resp.error || 'Failed to create NIC speed');
      setNewNicSpeedName('');
      await load();
      closeAddDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to create NIC speed');
    } finally {
      setBusy(false);
    }
  };

  const deleteNicSpeed = async (id: number, label: string) => {
    await requestPicklistDelete('nicSpeed', id, label);
  };

  const getPicklistUsageCount = async (kind: PicklistKind, rowId: number): Promise<number> => {
    const safeRowId = Number(rowId);
    if (!Number.isFinite(safeRowId) || safeRowId <= 0) return 0;

    try {
      if (kind === 'sidType') {
        const resp = await apiClient.getSiteSidTypeUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'deviceModel') {
        const resp = await apiClient.getSiteSidDeviceModelUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'cpuModel') {
        const resp = await apiClient.getSiteSidCpuModelUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'platform') {
        const resp = await apiClient.getSiteSidPlatformUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'status') {
        const resp = await apiClient.getSiteSidStatusUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'passwordType') {
        const resp = await apiClient.getSiteSidPasswordTypeUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'vlan') {
        const resp = await apiClient.getSiteSidVlanUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'nicType') {
        const resp = await apiClient.getSiteSidNicTypeUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
      if (kind === 'nicSpeed') {
        const resp = await apiClient.getSiteSidNicSpeedUsage(siteId, safeRowId);
        return resp.success ? Number(resp.data?.sids_using ?? 0) : 0;
      }
    } catch {
      // ignore
    }

    return 0;
  };

  const performPicklistUpdate = async (kind: PicklistKind, rowId: number, payload: any) => {
    if (!requireAdmin()) return;

    try {
      setBusy(true);
      setOpError(null);

      if (kind === 'sidType') {
        const resp = await apiClient.updateSiteSidType(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update SID type');
      } else if (kind === 'deviceModel') {
        const resp = await apiClient.updateSiteSidDeviceModel(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update device model');
      } else if (kind === 'cpuModel') {
        const resp = await apiClient.updateSiteSidCpuModel(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update CPU model');
      } else if (kind === 'platform') {
        const resp = await apiClient.updateSiteSidPlatform(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update platform');
      } else if (kind === 'status') {
        const resp = await apiClient.updateSiteSidStatus(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update status');
      } else if (kind === 'passwordType') {
        const resp = await apiClient.updateSiteSidPasswordType(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update password type');
      } else if (kind === 'vlan') {
        const resp = await apiClient.updateSiteSidVlan(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update VLAN');
      } else if (kind === 'nicType') {
        const resp = await apiClient.updateSiteSidNicType(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update NIC type');
      } else if (kind === 'nicSpeed') {
        const resp = await apiClient.updateSiteSidNicSpeed(siteId, rowId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to update NIC speed');
      }

      await load();
      closeEditDialog();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setBusy(false);
    }
  };

  const requestPicklistUpdate = async (kind: PicklistKind, rowId: number, payload: any) => {
    if (!requireAdmin()) return;
    const usage = await getPicklistUsageCount(kind, rowId);
    if (usage > 0) {
      setPendingUpdate({ kind, rowId, payload, usageCount: usage });
      return;
    }
    await performPicklistUpdate(kind, rowId, payload);
  };

  const performPicklistDelete = async (kind: PicklistKind, rowId: number) => {
    if (!requireAdmin()) return;

    try {
      setBusy(true);
      setOpError(null);

      if (kind === 'sidType') {
        const resp = await apiClient.deleteSiteSidType(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete SID type');
      } else if (kind === 'deviceModel') {
        const resp = await apiClient.deleteSiteSidDeviceModel(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete device model');
      } else if (kind === 'cpuModel') {
        const resp = await apiClient.deleteSiteSidCpuModel(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete CPU model');
      } else if (kind === 'platform') {
        const resp = await apiClient.deleteSiteSidPlatform(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete platform');
      } else if (kind === 'status') {
        const resp = await apiClient.deleteSiteSidStatus(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete status');
      } else if (kind === 'passwordType') {
        const resp = await apiClient.deleteSiteSidPasswordType(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete password type');
      } else if (kind === 'vlan') {
        const resp = await apiClient.deleteSiteSidVlan(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete VLAN');
      } else if (kind === 'nicType') {
        const resp = await apiClient.deleteSiteSidNicType(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete NIC type');
      } else if (kind === 'nicSpeed') {
        const resp = await apiClient.deleteSiteSidNicSpeed(siteId, rowId);
        if (!resp.success) throw new Error(resp.error || 'Failed to delete NIC speed');
      }

      await load();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  const requestPicklistDelete = async (kind: PicklistKind, rowId: number, label: string) => {
    if (!requireAdmin()) return;
    const usage = await getPicklistUsageCount(kind, rowId);
    setPendingDelete({ kind, rowId, label, usageCount: usage });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-4 space-y-4 mx-auto w-full max-w-6xl">
        <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}/sid`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to SID Index
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-6 mx-auto w-full max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}/sid`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to SID Index
          </Button>
          <div>
            <h1 className="text-2xl font-bold">SID Admin</h1>
            <p className="text-muted-foreground">Picklists</p>
          </div>
        </div>
      </div>

      {!canAdmin && (
        <Alert variant="destructive">
          <AlertDescription>Site admin access required.</AlertDescription>
        </Alert>
      )}

      {opError && (
        <Alert variant="destructive">
          <AlertDescription>{opError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-10">
          <TabsTrigger value="types">Device Types</TabsTrigger>
          <TabsTrigger value="devices">Device Models</TabsTrigger>
          <TabsTrigger value="cpus">CPU Models</TabsTrigger>
          <TabsTrigger value="platforms">Platforms</TabsTrigger>
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="passwordTypes">Password Types</TabsTrigger>
          <TabsTrigger value="vlans">VLANs</TabsTrigger>
          <TabsTrigger value="nicTypes">NIC Types</TabsTrigger>
          <TabsTrigger value="nicSpeeds">NIC Speeds</TabsTrigger>
        </TabsList>

        <TabsContent value="types">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Device Types</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewTypeName('');
                  setAddDialog('sidType');
                }}
                disabled={!canAdmin || busy}
              >
                Add SID Type
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sidTypes.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('sidType', t)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deleteType(t.id, String(t.name ?? 'SID Type'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Device Models</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewDeviceManufacturer('');
                  setNewDeviceName('');
                  setNewDeviceRackU('');
                  setNewDeviceIsSwitch(false);
                  setNewDeviceDefaultSwitchPortCount('');
                  setNewDeviceIsPatchPanel(false);
                  setNewDeviceDefaultPatchPanelPortCount('');
                  setAddDialog('deviceModel');
                }}
                disabled={!canAdmin || busy}
              >
                Add Device Model
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Rack U</TableHead>
                    <TableHead>Switch Model</TableHead>
                    <TableHead>Switch Ports</TableHead>
                    <TableHead>Patch Panel</TableHead>
                    <TableHead>Patch Panel Ports</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deviceModels.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.manufacturer || '—'}</TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>{m.rack_u ?? '—'}</TableCell>
                      <TableCell>{Boolean(m.is_switch) ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{Boolean(m.is_switch) ? (m.default_switch_port_count ?? '—') : '—'}</TableCell>
                      <TableCell>{Boolean(m.is_patch_panel) ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{Boolean(m.is_patch_panel) ? (m.default_patch_panel_port_count ?? '—') : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('deviceModel', m)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deleteDeviceModel(m.id, String(m.name ?? 'Device Model'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cpus">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>CPU Models</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewCpuManufacturer('');
                  setNewCpuName('');
                  setNewCpuCores('');
                  setNewCpuThreads('');
                  setAddDialog('cpuModel');
                }}
                disabled={!canAdmin || busy}
              >
                Add CPU Model
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cpuModels.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.manufacturer || '—'}</TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('cpuModel', m)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deleteCpuModel(m.id, String(m.name ?? 'CPU Model'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="platforms">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Platforms</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewPlatformName('');
                  setAddDialog('platform');
                }}
                disabled={!canAdmin || busy}
              >
                Add Platform
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platforms.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('platform', p)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deletePlatform(p.id, String(p.name ?? 'Platform'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statuses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Statuses</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewStatusName('');
                  setAddDialog('status');
                }}
                disabled={!canAdmin || busy}
              >
                Add Status
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStatuses.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (String(s?.name ?? '').trim().toLowerCase() === 'deleted') return;
                            openEditDialog('status', s);
                          }}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (String(s?.name ?? '').trim().toLowerCase() === 'deleted') return;
                            deleteStatus(s.id, String(s.name ?? 'Status'));
                          }}
                          disabled={!canAdmin || busy}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations">
          <Card>
            <CardHeader>
              <CardTitle>Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <SiteLocationsManager
                siteId={siteId}
                siteCode={siteCode ?? ''}
                siteName={siteName ?? ''}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="passwordTypes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Password Types</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewPasswordTypeName('');
                  setAddDialog('passwordType');
                }}
                disabled={!canAdmin || busy}
              >
                Add Password Type
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {passwordTypes.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('passwordType', t)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deletePasswordType(t.id, String(t.name ?? 'Password Type'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vlans">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>VLANs</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewVlanId('');
                  setNewVlanName('');
                  setAddDialog('vlan');
                }}
                disabled={!canAdmin || busy}
              >
                Add VLAN
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VLAN</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vlans.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.vlan_id}</TableCell>
                      <TableCell>{v.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('vlan', v)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const vlanLabel = `${String(v.vlan_id ?? '').trim() || 'VLAN'}${String(v.name ?? '').trim() ? ` (${String(v.name ?? '').trim()})` : ''}`;
                            deleteVlan(v.id, vlanLabel);
                          }}
                          disabled={!canAdmin || busy}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nicTypes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>NIC Types</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewNicTypeName('');
                  setAddDialog('nicType');
                }}
                disabled={!canAdmin || busy}
              >
                Add NIC Type
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nicTypes.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('nicType', t)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deleteNicType(t.id, String(t.name ?? 'NIC Type'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nicSpeeds">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>NIC Speeds</CardTitle>
              <Button
                onClick={() => {
                  setOpError(null);
                  setNewNicSpeedName('');
                  setAddDialog('nicSpeed');
                }}
                disabled={!canAdmin || busy}
              >
                Add NIC Speed
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nicSpeeds.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          onClick={() => openEditDialog('nicSpeed', t)}
                          disabled={!canAdmin || busy}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => deleteNicSpeed(t.id, String(t.name ?? 'NIC Speed'))} disabled={!canAdmin || busy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editDialog !== null} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editDialog === 'sidType'
                ? 'Edit SID Type'
                : editDialog === 'deviceModel'
                  ? 'Edit Device Model'
                  : editDialog === 'cpuModel'
                    ? 'Edit CPU Model'
                    : editDialog === 'platform'
                      ? 'Edit Platform'
                      : editDialog === 'status'
                        ? 'Edit Status'
                        : editDialog === 'passwordType'
                          ? 'Edit Password Type'
                          : editDialog === 'vlan'
                            ? 'Edit VLAN'
                            : editDialog === 'nicType'
                              ? 'Edit NIC Type'
                              : editDialog === 'nicSpeed'
                                ? 'Edit NIC Speed'
                            : ''}
            </DialogTitle>
            <DialogDescription>Save changes will apply to all SIDs using this value.</DialogDescription>
          </DialogHeader>

          {editDialog === 'sidType' && (
            <div className="space-y-2">
              <Label htmlFor="edit-sid-type">Name</Label>
              <Input
                id="edit-sid-type"
                value={editTypeName}
                onChange={(e) => setEditTypeName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          {editDialog === 'deviceModel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-device-mfr">Manufacturer</Label>
                <Input
                  id="edit-device-mfr"
                  value={editDeviceManufacturer}
                  onChange={(e) => setEditDeviceManufacturer(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-device-name">Name</Label>
                <Input
                  id="edit-device-name"
                  value={editDeviceName}
                  onChange={(e) => setEditDeviceName(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-device-rack-u">Rack U</Label>
                <Input
                  id="edit-device-rack-u"
                  type="number"
                  min={1}
                  max={99}
                  value={editDeviceRackU}
                  onChange={(e) => setEditDeviceRackU(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., 1"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-device-is-switch">Is a Switch or Router?</Label>
                <Switch
                  id="edit-device-is-switch"
                  checked={editDeviceIsSwitch}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked);
                    setEditDeviceIsSwitch(next);
                    if (!next) {
                      setEditDeviceDefaultSwitchPortCount('');
                      return;
                    }
                    setEditDeviceIsPatchPanel(false);
                    setEditDeviceDefaultPatchPanelPortCount('');
                  }}
                  disabled={!canAdmin || busy}
                />
              </div>
              {editDeviceIsSwitch && (
                <div className="space-y-2">
                  <Label htmlFor="edit-device-default-switch-port-count">Default Switch Port Count</Label>
                  <Input
                    id="edit-device-default-switch-port-count"
                    type="number"
                    min={1}
                    max={4096}
                    value={editDeviceDefaultSwitchPortCount}
                    onChange={(e) => setEditDeviceDefaultSwitchPortCount(e.target.value)}
                    disabled={!canAdmin || busy}
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-device-is-patch-panel">Is a Patch Panel?</Label>
                <Switch
                  id="edit-device-is-patch-panel"
                  checked={editDeviceIsPatchPanel}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked);
                    setEditDeviceIsPatchPanel(next);
                    if (!next) {
                      setEditDeviceDefaultPatchPanelPortCount('');
                      return;
                    }
                    setEditDeviceIsSwitch(false);
                    setEditDeviceDefaultSwitchPortCount('');
                  }}
                  disabled={!canAdmin || busy}
                />
              </div>
              {editDeviceIsPatchPanel && (
                <div className="space-y-2">
                  <Label htmlFor="edit-device-default-patch-panel-port-count">Default Patch Panel Port Count</Label>
                  <Input
                    id="edit-device-default-patch-panel-port-count"
                    type="number"
                    min={1}
                    max={4096}
                    value={editDeviceDefaultPatchPanelPortCount}
                    onChange={(e) => setEditDeviceDefaultPatchPanelPortCount(e.target.value)}
                    disabled={!canAdmin || busy}
                  />
                </div>
              )}
            </div>
          )}

          {editDialog === 'cpuModel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-cpu-mfr">Manufacturer</Label>
                <Input
                  id="edit-cpu-mfr"
                  value={editCpuManufacturer}
                  onChange={(e) => setEditCpuManufacturer(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cpu-name">Name</Label>
                <Input
                  id="edit-cpu-name"
                  value={editCpuName}
                  onChange={(e) => setEditCpuName(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-cpu-cores">CPU Cores</Label>
                  <Input
                    id="edit-cpu-cores"
                    type="number"
                    value={editCpuCores}
                    onChange={(e) => setEditCpuCores(e.target.value)}
                    disabled={!canAdmin || busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-cpu-threads">CPU Threads</Label>
                  <Input
                    id="edit-cpu-threads"
                    type="number"
                    value={editCpuThreads}
                    onChange={(e) => setEditCpuThreads(e.target.value)}
                    disabled={!canAdmin || busy}
                  />
                </div>
              </div>
            </div>
          )}

          {editDialog === 'platform' && (
            <div className="space-y-2">
              <Label htmlFor="edit-platform">Name</Label>
              <Input
                id="edit-platform"
                value={editPlatformName}
                onChange={(e) => setEditPlatformName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          {editDialog === 'status' && (
            <div className="space-y-2">
              <Label htmlFor="edit-status">Name</Label>
              <Input
                id="edit-status"
                value={editStatusName}
                onChange={(e) => setEditStatusName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          {editDialog === 'passwordType' && (
            <div className="space-y-2">
              <Label htmlFor="edit-password-type">Name</Label>
              <Input
                id="edit-password-type"
                value={editPasswordTypeName}
                onChange={(e) => setEditPasswordTypeName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          {editDialog === 'vlan' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-vlan-id">VLAN ID</Label>
                <Input
                  id="edit-vlan-id"
                  value={editVlanId}
                  onChange={(e) => setEditVlanId(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vlan-name">Name</Label>
                <Input
                  id="edit-vlan-name"
                  value={editVlanName}
                  onChange={(e) => setEditVlanName(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </div>
            </div>
          )}

          {editDialog === 'nicType' && (
            <div className="space-y-2">
              <Label htmlFor="edit-nic-type">Name</Label>
              <Input
                id="edit-nic-type"
                value={editNicTypeName}
                onChange={(e) => setEditNicTypeName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          {editDialog === 'nicSpeed' && (
            <div className="space-y-2">
              <Label htmlFor="edit-nic-speed">Name</Label>
              <Input
                id="edit-nic-speed"
                value={editNicSpeedName}
                onChange={(e) => setEditNicSpeedName(e.target.value)}
                disabled={!canAdmin || busy}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!editDialog || !editRowId) return;

                if (editDialog === 'sidType') {
                  const name = editTypeName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('sidType', editRowId, { name });
                } else if (editDialog === 'deviceModel') {
                  const name = editDeviceName.trim();
                  const defaultPortCount = Number(editDeviceDefaultSwitchPortCount);
                  const defaultPatchPanelPortCount = Number(editDeviceDefaultPatchPanelPortCount);
                  const rackUText = editDeviceRackU.trim();
                  const rackUNumber = Number(rackUText);
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  if (rackUText !== '' && (!Number.isFinite(rackUNumber) || !Number.isInteger(rackUNumber) || rackUNumber <= 0 || rackUNumber > 99)) {
                    setOpError('Rack U must be a whole number between 1 and 99');
                    return;
                  }
                  const rackU = rackUText === '' ? null : rackUNumber;
                  if (editDeviceIsSwitch && (!Number.isFinite(defaultPortCount) || defaultPortCount <= 0 || defaultPortCount > 4096)) {
                    setOpError('Switch port count must be 1-4096');
                    return;
                  }
                  if (editDeviceIsPatchPanel && (!Number.isFinite(defaultPatchPanelPortCount) || defaultPatchPanelPortCount <= 0 || defaultPatchPanelPortCount > 4096)) {
                    setOpError('Patch panel port count must be 1-4096');
                    return;
                  }
                  await requestPicklistUpdate('deviceModel', editRowId, {
                    manufacturer: editDeviceManufacturer.trim() || null,
                    name,
                    rack_u: rackU,
                    is_switch: editDeviceIsSwitch,
                    default_switch_port_count: editDeviceIsSwitch ? defaultPortCount : null,
                    is_patch_panel: editDeviceIsPatchPanel,
                    default_patch_panel_port_count: editDeviceIsPatchPanel ? defaultPatchPanelPortCount : null,
                  });
                } else if (editDialog === 'cpuModel') {
                  const name = editCpuName.trim();
                  const cpuCores = Number(editCpuCores);
                  const cpuThreads = Number(editCpuThreads);
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  if (!Number.isFinite(cpuCores) || cpuCores <= 0) {
                    setOpError('CPU cores must be a positive number');
                    return;
                  }
                  if (!Number.isFinite(cpuThreads) || cpuThreads <= 0) {
                    setOpError('CPU threads must be a positive number');
                    return;
                  }
                  await requestPicklistUpdate('cpuModel', editRowId, {
                    manufacturer: editCpuManufacturer.trim() || null,
                    name,
                    cpu_cores: cpuCores,
                    cpu_threads: cpuThreads,
                  });
                } else if (editDialog === 'platform') {
                  const name = editPlatformName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('platform', editRowId, { name });
                } else if (editDialog === 'status') {
                  const name = editStatusName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('status', editRowId, { name });
                } else if (editDialog === 'passwordType') {
                  const name = editPasswordTypeName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('passwordType', editRowId, { name });
                } else if (editDialog === 'vlan') {
                  const vlanId = Number(editVlanId);
                  const name = editVlanName.trim();
                  if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) {
                    setOpError('VLAN ID must be 1-4094');
                    return;
                  }
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('vlan', editRowId, { vlan_id: vlanId, name });
                } else if (editDialog === 'nicType') {
                  const name = editNicTypeName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('nicType', editRowId, { name });
                } else if (editDialog === 'nicSpeed') {
                  const name = editNicSpeedName.trim();
                  if (!name) {
                    setOpError('Name is required');
                    return;
                  }
                  await requestPicklistUpdate('nicSpeed', editRowId, { name });
                }
              }}
              disabled={!canAdmin || busy}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingUpdate !== null} onOpenChange={(open) => !open && setPendingUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm changes</AlertDialogTitle>
            <AlertDialogDescription>
              This picklist value is currently used by {pendingUpdate?.usageCount ?? 0} SIDs. Saving changes will update all of those SIDs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingUpdate) return;
                await performPicklistUpdate(pendingUpdate.kind, pendingUpdate.rowId, pendingUpdate.payload);
                setPendingUpdate(null);
              }}
            >
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{pendingDelete?.label ?? 'this picklist value'}"?
              {` `}
              {Number(pendingDelete?.usageCount ?? 0) > 0
                ? `This will remove it from ${pendingDelete?.usageCount ?? 0} SIDs.`
                : 'It is not currently used by any SIDs.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                await performPicklistDelete(pendingDelete.kind, pendingDelete.rowId);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addDialog !== null} onOpenChange={(open) => !open && closeAddDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addDialog === 'sidType'
                ? 'Add SID Type'
                : addDialog === 'deviceModel'
                  ? 'Add Device Model'
                  : addDialog === 'cpuModel'
                    ? 'Add CPU Model'
                    : addDialog === 'platform'
                      ? 'Add Platform'
                      : addDialog === 'status'
                        ? 'Add Status'
                        : addDialog === 'passwordType'
                          ? 'Add Password Type'
                          : addDialog === 'vlan'
                            ? 'Add VLAN'
                            : addDialog === 'nicType'
                              ? 'Add NIC Type'
                              : addDialog === 'nicSpeed'
                                ? 'Add NIC Speed'
                                : ''}
            </DialogTitle>
            <DialogDescription>
              {addDialog === 'sidType'
                ? 'Create a new SID type for this site.'
                : addDialog === 'deviceModel'
                  ? 'Create a new device model for this site.'
                  : addDialog === 'cpuModel'
                    ? 'Create a new CPU model for this site.'
                  : addDialog === 'platform'
                    ? 'Create a new platform (OS family) for this site.'
                      : addDialog === 'status'
                        ? 'Create a new status for this site.'
                        : addDialog === 'passwordType'
                          ? 'Create a new password type for this site.'
                            : addDialog === 'vlan'
                              ? 'Create a new VLAN for this site.'
                              : addDialog === 'nicType'
                                ? 'Create a new NIC Type option for this site.'
                                : addDialog === 'nicSpeed'
                                  ? 'Create a new NIC Speed option for this site.'
                                  : ''}
            </DialogDescription>
          </DialogHeader>

          {addDialog === 'sidType' && (
            <div className="space-y-2">
              <Label htmlFor="add-sid-type">Name</Label>
              <Input
                id="add-sid-type"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., Server, Switch, Patch Panel"
              />
            </div>
          )}

          {addDialog === 'deviceModel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-device-mfr">Manufacturer</Label>
                <Input
                  id="add-device-mfr"
                  value={newDeviceManufacturer}
                  onChange={(e) => setNewDeviceManufacturer(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., Dell"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-device-name">Name</Label>
                <Input
                  id="add-device-name"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., R740"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-device-rack-u">Rack U</Label>
                <Input
                  id="add-device-rack-u"
                  type="number"
                  min={1}
                  max={99}
                  value={newDeviceRackU}
                  onChange={(e) => setNewDeviceRackU(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., 1"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="add-device-is-switch">Is a Switch or Router?</Label>
                <Switch
                  id="add-device-is-switch"
                  checked={newDeviceIsSwitch}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked);
                    setNewDeviceIsSwitch(next);
                    if (!next) {
                      setNewDeviceDefaultSwitchPortCount('');
                      return;
                    }
                    setNewDeviceIsPatchPanel(false);
                    setNewDeviceDefaultPatchPanelPortCount('');
                  }}
                  disabled={!canAdmin || busy}
                />
              </div>
              {newDeviceIsSwitch && (
                <div className="space-y-2">
                  <Label htmlFor="add-device-default-switch-port-count">Default Switch Port Count</Label>
                  <Input
                    id="add-device-default-switch-port-count"
                    type="number"
                    min={1}
                    max={4096}
                    value={newDeviceDefaultSwitchPortCount}
                    onChange={(e) => setNewDeviceDefaultSwitchPortCount(e.target.value)}
                    disabled={!canAdmin || busy}
                    placeholder="e.g., 24"
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="add-device-is-patch-panel">Is a Patch Panel?</Label>
                <Switch
                  id="add-device-is-patch-panel"
                  checked={newDeviceIsPatchPanel}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked);
                    setNewDeviceIsPatchPanel(next);
                    if (!next) {
                      setNewDeviceDefaultPatchPanelPortCount('');
                      return;
                    }
                    setNewDeviceIsSwitch(false);
                    setNewDeviceDefaultSwitchPortCount('');
                  }}
                  disabled={!canAdmin || busy}
                />
              </div>
              {newDeviceIsPatchPanel && (
                <div className="space-y-2">
                  <Label htmlFor="add-device-default-patch-panel-port-count">Default Patch Panel Port Count</Label>
                  <Input
                    id="add-device-default-patch-panel-port-count"
                    type="number"
                    min={1}
                    max={4096}
                    value={newDeviceDefaultPatchPanelPortCount}
                    onChange={(e) => setNewDeviceDefaultPatchPanelPortCount(e.target.value)}
                    disabled={!canAdmin || busy}
                    placeholder="e.g., 24"
                  />
                </div>
              )}
            </div>
          )}

          {addDialog === 'cpuModel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-cpu-mfr">Manufacturer</Label>
                <Input
                  id="add-cpu-mfr"
                  value={newCpuManufacturer}
                  onChange={(e) => setNewCpuManufacturer(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., Intel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-cpu-name">Model</Label>
                <Input
                  id="add-cpu-name"
                  value={newCpuName}
                  onChange={(e) => setNewCpuName(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., Xeon Gold 6130"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="add-cpu-cores">CPU Cores</Label>
                  <Input
                    id="add-cpu-cores"
                    type="number"
                    value={newCpuCores}
                    onChange={(e) => setNewCpuCores(e.target.value)}
                    disabled={!canAdmin || busy}
                    placeholder="e.g., 16"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-cpu-threads">CPU Threads</Label>
                  <Input
                    id="add-cpu-threads"
                    type="number"
                    value={newCpuThreads}
                    onChange={(e) => setNewCpuThreads(e.target.value)}
                    disabled={!canAdmin || busy}
                    placeholder="e.g., 32"
                  />
                </div>
              </div>
            </div>
          )}

          {addDialog === 'platform' && (
            <div className="space-y-2">
              <Label htmlFor="add-platform">Name</Label>
              <Input
                id="add-platform"
                value={newPlatformName}
                onChange={(e) => setNewPlatformName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., Windows, Linux, ESXi"
              />
            </div>
          )}

          {addDialog === 'status' && (
            <div className="space-y-2">
              <Label htmlFor="add-status">Name</Label>
              <Input
                id="add-status"
                value={newStatusName}
                onChange={(e) => setNewStatusName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., Active"
              />
            </div>
          )}

          {addDialog === 'passwordType' && (
            <div className="space-y-2">
              <Label htmlFor="add-password-type">Name</Label>
              <Input
                id="add-password-type"
                value={newPasswordTypeName}
                onChange={(e) => setNewPasswordTypeName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., Admin OS Credentials, iDRAC Credentials"
              />
            </div>
          )}

          {addDialog === 'vlan' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-vlan-id">VLAN ID</Label>
                <Input
                  id="add-vlan-id"
                  value={newVlanId}
                  onChange={(e) => setNewVlanId(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g. 10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-vlan-name">Name</Label>
                <Input
                  id="add-vlan-name"
                  value={newVlanName}
                  onChange={(e) => setNewVlanName(e.target.value)}
                  disabled={!canAdmin || busy}
                  placeholder="e.g., Management"
                />
              </div>
            </div>
          )}

          {addDialog === 'nicType' && (
            <div className="space-y-2">
              <Label htmlFor="add-nic-type">Name</Label>
              <Input
                id="add-nic-type"
                value={newNicTypeName}
                onChange={(e) => setNewNicTypeName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., RJ45, SFP+, QSFP"
              />
            </div>
          )}

          {addDialog === 'nicSpeed' && (
            <div className="space-y-2">
              <Label htmlFor="add-nic-speed">Name</Label>
              <Input
                id="add-nic-speed"
                value={newNicSpeedName}
                onChange={(e) => setNewNicSpeedName(e.target.value)}
                disabled={!canAdmin || busy}
                placeholder="e.g., 1G, 10G, 25G"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeAddDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (addDialog === 'sidType') await createType();
                else if (addDialog === 'deviceModel') await createDeviceModel();
                else if (addDialog === 'cpuModel') await createCpuModel();
                else if (addDialog === 'platform') await createPlatform();
                else if (addDialog === 'status') await createStatus();
                else if (addDialog === 'passwordType') await createPasswordType();
                else if (addDialog === 'vlan') await createVlan();
                else if (addDialog === 'nicType') await createNicType();
                else if (addDialog === 'nicSpeed') await createNicSpeed();
              }}
              disabled={!canAdmin || busy}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SiteSidAdminPage;
