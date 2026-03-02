import React from 'react';
import { toast } from 'sonner';
import {
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react';

import { ApiError, apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import usePermissions from '../hooks/usePermissions';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import LocationHierarchyDropdown from '../components/locations/LocationHierarchyDropdown';

type SidRecord = any;

type SidDetailPageMode = 'view' | 'create';

type SidDetailPageProps = {
  mode?: SidDetailPageMode;
};

type PendingNavigation =
  | { kind: 'path'; to: string }
  | { kind: 'back' }
  | null;

type PendingNetworkingRemoval =
  | { kind: 'card'; cardName: string }
  | { kind: 'nic'; globalNicIndex: number; nextSelectedNicTab: string; label: string }
  | null;

type PendingExtraIpRemoval =
  | { index: number; label: string; ipText: string }
  | null;

function isNotePinned(note: any): boolean {
  return note?.pinned === true;
}

function sortNotesPinnedFirst(input: any[]): any[] {
  const list = Array.isArray(input) ? input.slice() : [];
  list.sort((a, b) => {
    const ap = isNotePinned(a) ? 1 : 0;
    const bp = isNotePinned(b) ? 1 : 0;
    if (bp !== ap) return bp - ap;

    if (ap === 1) {
      const aPinnedAt = new Date(a?.pinned_at ?? a?.created_at ?? 0).getTime();
      const bPinnedAt = new Date(b?.pinned_at ?? b?.created_at ?? 0).getTime();
      if (bPinnedAt !== aPinnedAt) return bPinnedAt - aPinnedAt;
    }

    const aCreated = new Date(a?.created_at ?? 0).getTime();
    const bCreated = new Date(b?.created_at ?? 0).getTime();
    if (bCreated !== aCreated) return bCreated - aCreated;

    const aId = Number(a?.id ?? 0);
    const bId = Number(b?.id ?? 0);
    return bId - aId;
  });
  return list;
}

function formatNoteHeader(createdAt: any, username: any): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) {
    const u = String(username ?? '').trim();
    return u ? `${String(createdAt ?? '')} - ${u}` : String(createdAt ?? '');
  }

  const dateParts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);

  const getDate = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((p) => p.type === type)?.value ?? '';

  const dateStr = `${getDate('weekday')} ${getDate('day')} ${getDate('month')} ${getDate('year')}`.trim();

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const getTime = (type: Intl.DateTimeFormatPartTypes) =>
    timeParts.find((p) => p.type === type)?.value ?? '';

  const timeStr = `${getTime('hour')}:${getTime('minute')}:${getTime('second')}`;

  const u = String(username ?? '').trim();
  return `${dateStr} - ${timeStr}${u ? ` - ${u}` : ''}`;
}

function formatHistoryFieldLabel(field: unknown): string {
  const raw = String(field ?? '').trim();
  if (!raw) return 'Field';

  const mappedLabels: Record<string, string> = {
    sid_number: 'SID Number',
    sid_type_id: 'SID Type',
    device_model_id: 'Device Model',
    cpu_model_id: 'CPU Model',
    platform_id: 'Platform',
    location_id: 'Location',
    rack_u: 'Rack U',
    ram_gb: 'RAM (GB)',
    cpu_count: 'CPU Count',
    cpu_cores: 'CPU Cores',
    cpu_threads: 'CPU Threads',
    serial_number: 'Serial Number',
    hostname: 'Hostname',
    status: 'Status',
    os_name: 'OS Name',
    os_version: 'OS Version',
    mgmt_ip: 'Mgmt IP',
    mgmt_mac: 'Mgmt MAC',
    primary_ip: 'Primary IP',
    subnet_ip: 'Subnet IP',
    gateway_ip: 'Gateway IP',
    switch_port_count: 'Switch Port Count',
    pdu_power: 'PDU Power',
    note_type: 'Note Type',
    note_preview: 'Note Preview',
    password_type_name: 'Password Type',
    username_from: 'Username',
    username_to: 'Username',
    password_changed: 'Password',
  };

  const mapped = mappedLabels[raw.toLowerCase()];
  if (mapped) return mapped;

  const withSpaces = raw.replace(/_/g, ' ');
  const acronyms = new Set(['id', 'ip', 'mac', 'cpu', 'os', 'sid', 'vlan', 'nic', 'pdu']);

  return withSpaces.replace(/\b[a-z][a-z0-9]*\b/gi, (word) => {
    const lower = word.toLowerCase();
    if (acronyms.has(lower)) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

const SidDetailPage: React.FC<SidDetailPageProps> = ({ mode = 'view' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const isCreate = mode === 'create';
  const siteId = Number(params.siteId);
  const sidId = isCreate ? 0 : Number(params.sidId);
  const { user, memberships } = useAuth();
  const permissions = usePermissions();

  const canEdit = permissions.canAdministerSite(siteId);
  const canCreateSid = Boolean(
    user &&
      (user.role === 'GLOBAL_ADMIN' || (memberships ?? []).some((m) => Number(m.site_id) === siteId))
  );
  const canModifyBase = isCreate ? canCreateSid : canEdit;

  const [siteName, setSiteName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [sid, setSid] = React.useState<SidRecord | null>(null);
  const [notes, setNotes] = React.useState<any[]>([]);
  const [nics, setNics] = React.useState<any[]>([]);
  const [extraIps, setExtraIps] = React.useState<string[]>([]);

  const isReadOnly = !isCreate && String((sid as any)?.status ?? '').trim().toLowerCase() === 'deleted';
  const canModify = canModifyBase && !isReadOnly;
  const canEditWrite = canEdit && !isReadOnly;

  const [sidTypes, setSidTypes] = React.useState<any[]>([]);
  const [deviceModels, setDeviceModels] = React.useState<any[]>([]);
  const [cpuModels, setCpuModels] = React.useState<any[]>([]);
  const [platforms, setPlatforms] = React.useState<any[]>([]);
  const [statuses, setStatuses] = React.useState<any[]>([]);
  const [vlans, setVlans] = React.useState<any[]>([]);
  const [nicTypes, setNicTypes] = React.useState<any[]>([]);
  const [nicSpeeds, setNicSpeeds] = React.useState<any[]>([]);
  const [locations, setLocations] = React.useState<any[]>([]);
  const [siteSids, setSiteSids] = React.useState<any[]>([]);

  const [activeTab, setActiveTab] = React.useState('main');
  const [mainSubtab, setMainSubtab] = React.useState<'notes' | 'passwords' | 'history'>('notes');
  const [hardwareSubtab, setHardwareSubtab] = React.useState<'configuration' | 'parts'>('configuration');
  const [networkingSubtab, setNetworkingSubtab] = React.useState<'configuration' | 'ip_addresses'>('configuration');
  const [networkingCardTab, setNetworkingCardTab] = React.useState<string>('On-Board Network Card');
  const [networkingNicTab, setNetworkingNicTab] = React.useState<string>('0');

  const [addNetworkCardOpen, setAddNetworkCardOpen] = React.useState(false);
  const [newNetworkCardName, setNewNetworkCardName] = React.useState('');
  const [newNetworkCardError, setNewNetworkCardError] = React.useState<string | null>(null);
  const [pendingNetworkingRemoval, setPendingNetworkingRemoval] = React.useState<PendingNetworkingRemoval>(null);
  const [pendingExtraIpRemoval, setPendingExtraIpRemoval] = React.useState<PendingExtraIpRemoval>(null);
  const [saveLoading, setSaveLoading] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [missingRequiredOpen, setMissingRequiredOpen] = React.useState(false);

  const shouldLogViewRef = React.useRef<boolean>(!isCreate);

  const [newNote, setNewNote] = React.useState('');
  const [noteLoading, setNoteLoading] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);

  const [pinLoadingId, setPinLoadingId] = React.useState<number | null>(null);

  const [history, setHistory] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  const [passwordMode, setPasswordMode] = React.useState<'typed' | 'legacy'>('typed');
  const [passwordMeta, setPasswordMeta] = React.useState<any | null>(null);
  const [passwordTypes, setPasswordTypes] = React.useState<any[]>([]);
  const [passwords, setPasswords] = React.useState<any[]>([]);
  const [passwordUsername, setPasswordUsername] = React.useState('');
  const [passwordValue, setPasswordValue] = React.useState('');
  const [passwordLoading, setPasswordLoading] = React.useState(false);
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);

  const [createPasswordOpen, setCreatePasswordOpen] = React.useState(false);
  const [createPasswordTypeId, setCreatePasswordTypeId] = React.useState<string>('');
  const [createPasswordUsername, setCreatePasswordUsername] = React.useState('');
  const [createPasswordValue, setCreatePasswordValue] = React.useState('');

  const [editPasswordOpen, setEditPasswordOpen] = React.useState(false);
  const [editPasswordTypeId, setEditPasswordTypeId] = React.useState<number | null>(null);
  const [editPasswordTypeName, setEditPasswordTypeName] = React.useState('');
  const [editPasswordUsername, setEditPasswordUsername] = React.useState('');
  const [editPasswordValue, setEditPasswordValue] = React.useState('');

  // Closing note guard
  const [closingOpen, setClosingOpen] = React.useState(false);
  const [closingNoteText, setClosingNoteText] = React.useState('');
  const [closingError, setClosingError] = React.useState<string | null>(null);
  const [closingLoading, setClosingLoading] = React.useState(false);
  const [allowLeave, setAllowLeave] = React.useState(false);
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation>(null);

  React.useEffect(() => {
    if (isCreate) return;
    if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(sidId) || sidId <= 0) return;
    if (allowLeave) return;

    // Prevent browser back from leaving without closing note
    try {
      window.history.pushState({ sid_editor: true }, document.title, window.location.href);
    } catch {
      // ignore
    }

    const onPopState = (e: PopStateEvent) => {
      if (allowLeave) return;
      e.preventDefault();
      try {
        window.history.pushState({ sid_editor: true }, document.title, window.location.href);
      } catch {
        // ignore
      }
      setClosingError(null);
      setClosingNoteText('');
      setPendingNavigation({ kind: 'back' });
      setClosingOpen(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [allowLeave, siteId, sidId]);

  React.useEffect(() => {
    if (isCreate) return;
    if (allowLeave) return;

    // Intercept in-app link clicks (sidebar/header links) to enforce closing note.
    const onClickCapture = (e: MouseEvent) => {
      if (allowLeave) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#')) return;
      if (anchor.target && anchor.target !== '_self') return;

      // Only intercept same-origin navigation
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;

      const current = window.location.pathname + window.location.search + window.location.hash;
      const next = url.pathname + url.search + url.hash;
      if (next === current) return;

      e.preventDefault();
      setClosingError(null);
      setClosingNoteText('');
      setPendingNavigation({ kind: 'path', to: next });
      setClosingOpen(true);
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [allowLeave]);

  React.useEffect(() => {
    if (isCreate) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowLeave) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [allowLeave, isCreate]);

  React.useEffect(() => {
    if (isCreate) return;
    shouldLogViewRef.current = true;
  }, [isCreate, siteId, sidId]);

  React.useEffect(() => {
    if (isCreate) return;
    const state = (location.state ?? {}) as any;
    const createdInSession = state?.sidCreatedInSession === true;
    const createdSidId = Number(state?.createdSidId ?? 0);
    if (!createdInSession) return;
    if (!Number.isFinite(createdSidId) || createdSidId <= 0) return;
    if (createdSidId !== sidId) return;
    setAllowLeave(true);
  }, [isCreate, location.state, sidId]);

  const reload = React.useCallback(async () => {
    if (!Number.isFinite(siteId) || siteId <= 0) {
      setError('Invalid site');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [
        siteResp,
        sidResp,
        ipResp,
        typesResp,
        dmResp,
        cpuResp,
        platformResp,
        statusesResp,
        passwordTypesResp,
        vlanResp,
        nicTypesResp,
        nicSpeedsResp,
        locResp,
        siteSidsResp,
      ] = await Promise.all([
        apiClient.getSite(siteId),
        isCreate
          ? Promise.resolve({ success: true, data: { sid: null, notes: [], nics: [] } } as any)
          : apiClient.getSiteSid(siteId, sidId, { log_view: shouldLogViewRef.current }),
        isCreate
          ? Promise.resolve({ success: true, data: { ip_addresses: [] } } as any)
          : apiClient.getSiteSidIpAddresses(siteId, sidId),
        apiClient.getSiteSidTypes(siteId),
        apiClient.getSiteSidDeviceModels(siteId),
        apiClient.getSiteSidCpuModels(siteId),
        apiClient.getSiteSidPlatforms(siteId),
        apiClient.getSiteSidStatuses(siteId),
        apiClient.getSiteSidPasswordTypes(siteId),
        apiClient.getSiteSidVlans(siteId),
        apiClient.getSiteSidNicTypes(siteId),
        apiClient.getSiteSidNicSpeeds(siteId),
        apiClient.getSiteLocations(siteId),
        apiClient.getSiteSids(siteId, { limit: 500, offset: 0 }),
      ]);

      if (!siteResp.success) throw new Error(siteResp.error || 'Failed to load site');
      if (!isCreate && !sidResp.success) throw new Error(sidResp.error || 'Failed to load SID');

      setSiteName(siteResp.data?.site?.name ?? null);
      if (isCreate) {
        setSid({
          site_id: siteId,
          sid_number: '',
          sid_type_id: null,
          device_model_id: null,
          cpu_model_id: null,
          hostname: null,
          serial_number: null,
          status: null,
          cpu_count: null,
          cpu_cores: null,
          cpu_threads: null,
          ram_gb: null,
          platform_id: null,
          os_name: null,
          os_version: null,
          mgmt_ip: null,
          mgmt_mac: null,
          primary_ip: null,
          subnet_ip: null,
          gateway_ip: null,
          switch_port_count: null,
          location_id: null,
          pdu_power: null,
          rack_u: null,
        });
        setNotes([]);
        setNics([]);
        setExtraIps([]);
      } else {
        setSid(sidResp.data?.sid ?? null);
        setNotes(sortNotesPinnedFirst(sidResp.data?.notes ?? []));
        setNics(sidResp.data?.nics ?? []);
        setExtraIps(ipResp.success ? (ipResp.data?.ip_addresses ?? []) : []);
        shouldLogViewRef.current = false;
      }

      setSidTypes(typesResp.success ? (typesResp.data?.sid_types ?? []) : []);
      setDeviceModels(dmResp.success ? (dmResp.data?.device_models ?? []) : []);
      setCpuModels(cpuResp.success ? (cpuResp.data?.cpu_models ?? []) : []);
      setPlatforms(platformResp.success ? (platformResp.data?.platforms ?? []) : []);

      const loadedStatuses = statusesResp.success ? (statusesResp.data?.statuses ?? []) : [];
      setStatuses(loadedStatuses);
      setPasswordTypes(passwordTypesResp.success ? (passwordTypesResp.data?.password_types ?? []) : []);
      if (isCreate) {
        const hasNewSidStatus = (loadedStatuses ?? []).some((s: any) => String(s?.name ?? '').trim() === 'New SID');
        if (hasNewSidStatus) {
          setSid((prev: SidRecord | null) => {
            if (!prev) return prev;
            const current = String(prev.status ?? '').trim();
            if (current) return prev;
            return { ...prev, status: 'New SID' };
          });
        }
      }
      setVlans(vlanResp.success ? (vlanResp.data?.vlans ?? []) : []);
      setNicTypes(nicTypesResp.success ? (nicTypesResp.data?.nic_types ?? []) : []);
      setNicSpeeds(nicSpeedsResp.success ? (nicSpeedsResp.data?.nic_speeds ?? []) : []);
      setLocations(locResp.success ? (locResp.data?.locations ?? []) : []);
      setSiteSids(siteSidsResp.success ? (siteSidsResp.data?.sids ?? []) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [siteId, sidId, isCreate]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const updateSidLocal = (patch: Record<string, any>) => {
    setSid((prev: SidRecord | null) => ({ ...(prev ?? {}), ...patch }));
  };

  const statusOptions = React.useMemo(() => {
    const names = (statuses ?? [])
      .map((s) => String(s.name))
      .filter((name) => name.trim().toLowerCase() !== 'deleted');
    const current = (sid?.status ?? '').toString().trim();
    if (current && current.toLowerCase() !== 'deleted' && !names.includes(current)) return [current, ...names];
    return names;
  }, [statuses, sid?.status]);

  const missingCreatePrereqs = React.useMemo(() => {
    if (!isCreate) return [] as Array<{ key: string; label: string; href?: string }>; 

    const missing: Array<{ key: string; label: string; href?: string }> = [];
    if ((sidTypes ?? []).length === 0) missing.push({ key: 'types', label: 'Device Types', href: `/sites/${siteId}/sid/admin?tab=types` });
    if ((statuses ?? []).length === 0) missing.push({ key: 'statuses', label: 'SID Statuses', href: `/sites/${siteId}/sid/admin?tab=statuses` });
    if ((platforms ?? []).length === 0) missing.push({ key: 'platforms', label: 'Platforms', href: `/sites/${siteId}/sid/admin?tab=platforms` });
    if ((locations ?? []).length === 0) missing.push({ key: 'locations', label: 'Locations', href: `/sites/${siteId}/sid/admin?tab=locations` });
    if ((deviceModels ?? []).length === 0) missing.push({ key: 'models', label: 'Models', href: `/sites/${siteId}/sid/admin?tab=devices` });
    if ((cpuModels ?? []).length === 0) missing.push({ key: 'cpuModels', label: 'CPU Models', href: `/sites/${siteId}/sid/admin?tab=cpus` });
    if ((passwordTypes ?? []).length === 0) missing.push({ key: 'passwordTypes', label: 'Password Types', href: `/sites/${siteId}/sid/admin?tab=passwordTypes` });
    if ((vlans ?? []).length === 0) missing.push({ key: 'vlans', label: 'VLANs', href: `/sites/${siteId}/sid/admin?tab=vlans` });
    if ((nicTypes ?? []).length === 0) missing.push({ key: 'nicTypes', label: 'NIC Types', href: `/sites/${siteId}/sid/admin?tab=nicTypes` });
    if ((nicSpeeds ?? []).length === 0) missing.push({ key: 'nicSpeeds', label: 'NIC Speeds', href: `/sites/${siteId}/sid/admin?tab=nicSpeeds` });
    return missing;
  }, [isCreate, sidTypes, statuses, platforms, locations, deviceModels, cpuModels, passwordTypes, vlans, nicTypes, nicSpeeds, siteId]);

  const createPrereqsReady = missingCreatePrereqs.length === 0;

  const DEFAULT_NETWORK_CARD_NAME = 'On-Board Network Card';

  const switchSids = React.useMemo(() => {
    const list = Array.isArray(siteSids) ? siteSids : [];
    return list
      .filter((s) => Number(s?.id) !== Number(sidId))
      .filter((s) => {
        const hostname = String(s?.hostname ?? '').trim();
        const modelSwitch = s?.device_model_is_switch === true || Number(s?.device_model_is_switch ?? 0) === 1;
        const hasPorts = Number(s?.switch_port_count ?? 0) > 0;
        return hostname !== '' && (modelSwitch || hasPorts);
      })
      .slice()
      .sort((a, b) => {
        const ah = String(a?.hostname ?? '').trim();
        const bh = String(b?.hostname ?? '').trim();
        return ah.localeCompare(bh);
      });
  }, [siteSids, sidId]);

  const switchById = React.useMemo(() => {
    const map = new Map<number, any>();
    for (const s of switchSids) {
      map.set(Number(s.id), s);
    }
    return map;
  }, [switchSids]);

  const cardNames = React.useMemo(() => {
    const list = Array.isArray(nics) ? nics : [];
    const set = new Set<string>();
    for (const n of list) {
      const name = String(n?.card_name ?? '').trim();
      set.add(name || DEFAULT_NETWORK_CARD_NAME);
    }
    if (set.size === 0) set.add(DEFAULT_NETWORK_CARD_NAME);

    const all = Array.from(set);
    const others = all.filter((c) => c !== DEFAULT_NETWORK_CARD_NAME).sort((a, b) => a.localeCompare(b));
    return [DEFAULT_NETWORK_CARD_NAME, ...others];
  }, [nics]);

  React.useEffect(() => {
    if (!cardNames.includes(networkingCardTab)) {
      setNetworkingCardTab(cardNames[0] ?? DEFAULT_NETWORK_CARD_NAME);
      setNetworkingNicTab('0');
    }
  }, [cardNames.join('|')]);

  const cardNics = React.useMemo(() => {
    const list = Array.isArray(nics) ? nics : [];
    const targetCard = String(networkingCardTab ?? DEFAULT_NETWORK_CARD_NAME);
    const items: Array<{ index: number; nic: any; displayCardName: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const nic = list[i];
      const raw = String(nic?.card_name ?? '').trim();
      const displayCardName = raw || DEFAULT_NETWORK_CARD_NAME;
      if (displayCardName !== targetCard) continue;
      items.push({ index: i, nic, displayCardName });
    }
    return items;
  }, [nics, networkingCardTab]);

  React.useEffect(() => {
    const idx = Number(networkingNicTab);
    if (!Number.isFinite(idx) || idx < 0 || idx >= cardNics.length) {
      setNetworkingNicTab('0');
    }
  }, [cardNics.length, networkingNicTab]);

  const loadHistory = React.useCallback(async () => {
    if (isCreate) return;
    if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(sidId) || sidId <= 0) return;
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const resp = await apiClient.getSiteSidHistory(siteId, sidId);
      if (!resp.success) throw new Error(resp.error || 'Failed to load history');
      setHistory(resp.data?.history ?? []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [siteId, sidId]);

  const normalizeExtraIps = React.useCallback((values: string[]): string[] => {
    return Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => value.trim())
          .filter((value) => value !== '')
      )
    ).slice(0, 200);
  }, []);

  const extraIpCount = React.useMemo(() => normalizeExtraIps(extraIps).length, [extraIps, normalizeExtraIps]);

  const loadPassword = React.useCallback(async () => {
    if (isCreate) return;
    if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(sidId) || sidId <= 0) return;
    if (!canEdit) {
      setPasswordError('Site admin access required');
      return;
    }

    try {
      setPasswordLoading(true);
      setPasswordError(null);

      // Prefer typed passwords (per Password Type)
      const [ptResp, pwResp] = await Promise.all([
        apiClient.getSiteSidPasswordTypes(siteId),
        apiClient.getSiteSidPasswords(siteId, sidId),
      ]);

      if (ptResp.success && pwResp.success) {
        const pts = ptResp.data?.password_types ?? [];
        const pws = pwResp.data?.passwords ?? [];
        setPasswordMode('typed');
        setPasswordTypes(pts);
        setPasswords(pws);
        setPasswordMeta({ key_configured: pwResp.data?.key_configured });

        return;
      }

      // Fallback for older installs / migrations not applied.
      const resp = await apiClient.getSiteSidPassword(siteId, sidId);
      if (!resp.success) {
        const firstError = ptResp.success ? (pwResp.error || resp.error) : (ptResp.error || pwResp.error || resp.error);
        throw new Error(firstError || 'Failed to load passwords');
      }

      const meta = resp.data?.password ?? null;
      setPasswordMode('legacy');
      setPasswordMeta(meta);
      setPasswordTypes([]);
      setPasswords([]);
      setPasswordUsername((meta?.username ?? '').toString());
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to load passwords');
    } finally {
      setPasswordLoading(false);
    }
  }, [siteId, sidId, canEdit, isCreate]);

  const savedPasswordRows = React.useMemo(() => {
    if (passwordMode !== 'typed') return [];
    const list = Array.isArray(passwords) ? passwords : [];
    return list;
  }, [passwordMode, passwords]);

  const unusedPasswordTypes = React.useMemo(() => {
    if (passwordMode !== 'typed') return [];
    const used = new Set<number>();
    for (const p of Array.isArray(passwords) ? passwords : []) {
      const id = Number((p as any)?.password_type_id);
      if (Number.isFinite(id) && id > 0) used.add(id);
    }
    return (Array.isArray(passwordTypes) ? passwordTypes : []).filter((t: any) => !used.has(Number(t?.id)));
  }, [passwordMode, passwords, passwordTypes]);

  React.useEffect(() => {
    if (isCreate) return;
    if (activeTab !== 'main') return;
    if (mainSubtab === 'passwords') {
      void loadPassword();
    }
    if (mainSubtab === 'history') {
      void loadHistory();
    }
  }, [activeTab, mainSubtab, loadPassword, loadHistory, isCreate]);

  const saveLegacyPassword = async () => {
    if (isCreate) return;
    if (isReadOnly) {
      setPasswordError('SID is deleted and read-only');
      return;
    }
    if (!canEdit) {
      setPasswordError('Site admin access required');
      return;
    }

    try {
      setPasswordSaving(true);
      setPasswordError(null);

      const usernameTrimmed = passwordUsername.trim();
      const payload: { username?: string | null; password?: string | null } = {
        username: usernameTrimmed === '' ? null : usernameTrimmed,
      };
      if (passwordValue.trim() !== '') {
        payload.password = passwordValue;
      } else {
        payload.password = '';
      }

      const resp = await apiClient.updateSiteSidPassword(siteId, sidId, payload);
      if (!resp.success) throw new Error(resp.error || 'Failed to save');

      setPasswordValue('');
      await loadPassword();
      await loadHistory();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setPasswordSaving(false);
    }
  };

  const addTypedPassword = async () => {
    if (isCreate) return;
    if (isReadOnly) {
      setPasswordError('SID is deleted and read-only');
      return;
    }
    if (!canEdit) {
      setPasswordError('Site admin access required');
      return;
    }
    const typeId = Number(createPasswordTypeId);
    if (!Number.isFinite(typeId) || typeId <= 0) {
      setPasswordError('Password type is required');
      return;
    }
    const username = createPasswordUsername.trim();
    const password = createPasswordValue;
    if (!username) {
      setPasswordError('Username is required');
      return;
    }
    if (password.trim() === '') {
      setPasswordError('Password is required');
      return;
    }

    try {
      setPasswordSaving(true);
      setPasswordError(null);

      const resp = await apiClient.createSiteSidTypedPassword(siteId, sidId, {
        password_type_id: typeId,
        username,
        password,
      });
      if (!resp.success) throw new Error(resp.error || 'Failed to save');

      setCreatePasswordOpen(false);
      setCreatePasswordTypeId('');
      setCreatePasswordUsername('');
      setCreatePasswordValue('');

      await loadPassword();
      await loadHistory();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setPasswordSaving(false);
    }
  };

  const openEditPasswordDialog = (row: any) => {
    const typeId = Number(row?.password_type_id);
    if (!Number.isFinite(typeId) || typeId <= 0) return;

    setPasswordError(null);
    setEditPasswordTypeId(typeId);
    setEditPasswordTypeName(String(row?.password_type_name ?? 'Password'));
    setEditPasswordUsername(String(row?.username ?? ''));
    setEditPasswordValue('');
    setEditPasswordOpen(true);
  };

  const saveEditedTypedPassword = async () => {
    if (isCreate) return;
    if (isReadOnly) {
      setPasswordError('SID is deleted and read-only');
      return;
    }
    if (!canEdit) {
      setPasswordError('Site admin access required');
      return;
    }

    const typeId = Number(editPasswordTypeId);
    if (!Number.isFinite(typeId) || typeId <= 0) {
      setPasswordError('Password type is required');
      return;
    }

    const usernameTrimmed = editPasswordUsername.trim();
    const nextUsername = usernameTrimmed === '' ? null : usernameTrimmed;

    try {
      setPasswordSaving(true);
      setPasswordError(null);

      const payload: { username?: string | null; password?: string | null } = { username: nextUsername };
      if (editPasswordValue.trim() !== '') {
        payload.password = editPasswordValue;
      }

      const resp = await apiClient.updateSiteSidPasswordByType(siteId, sidId, typeId, payload);
      if (!resp.success) throw new Error(resp.error || 'Failed to save');

      setEditPasswordOpen(false);
      setEditPasswordValue('');

      await loadPassword();
      await loadHistory();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setPasswordSaving(false);
    }
  };

  const saveSid = async () => {
    if (!sid) return;
    if (!isCreate && isReadOnly) {
      setSaveError('SID is deleted and read-only');
      return;
    }
    try {
      setSaveLoading(true);
      setSaveError(null);

      if (isCreate) {
        if (!canCreateSid) {
          throw new Error('Site access required');
        }
        if (!createPrereqsReady) {
          throw new Error('SID prerequisites not configured');
        }
        if (missingCreateRequiredFields.length > 0) {
          throw new Error(`Missing required fields: ${missingCreateRequiredFields.join(', ')}`);
        }
      }

      const payload: Record<string, any> = {
        sid_type_id: sid.sid_type_id ?? null,
        device_model_id: sid.device_model_id ?? null,
        cpu_model_id: sid.cpu_model_id ?? null,
        hostname: sid.hostname ?? null,
        serial_number: sid.serial_number ?? null,
        status: sid.status ?? null,
        cpu_count: sid.cpu_count ?? null,
        cpu_cores: sid.cpu_cores ?? null,
        cpu_threads: sid.cpu_threads ?? null,
        ram_gb: sid.ram_gb ?? null,
        platform_id: sid.platform_id ?? null,
        os_name: sid.os_name ?? null,
        os_version: sid.os_version ?? null,
        mgmt_ip: sid.mgmt_ip ?? null,
        mgmt_mac: sid.mgmt_mac ?? null,
        primary_ip: sid.primary_ip ?? null,
        subnet_ip: sid.subnet_ip ?? null,
        gateway_ip: sid.gateway_ip ?? null,
        switch_port_count: sid.switch_port_count ?? null,
        location_id: sid.location_id ?? null,
        pdu_power: sid.pdu_power ?? null,
        rack_u: sid.rack_u ?? null,
      };

      // Avoid sending null status on update for legacy SIDs.
      if (!isCreate) {
        const status = String(sid.status ?? '').trim();
        if (!status) {
          delete payload.status;
        } else {
          payload.status = status;
        }
      } else {
        payload.status = String(sid.status ?? '').trim();
        payload.serial_number = String(sid.serial_number ?? '').trim();
      }

      if (isCreate) {
        const resp = await apiClient.createSiteSid(siteId, payload);
        if (!resp.success || !resp.data?.sid?.id) throw new Error(resp.error || 'Failed to create');

        const createdSidId = Number(resp.data.sid.id);

        // Persist NICs as part of Create SID (no separate "Save NICs" button)
        if (canEdit) {
          try {
            const nicsResp = await apiClient.replaceSiteSidNics(siteId, createdSidId, {
              nics: (nics ?? []).map((n) => ({
                card_name: (n.card_name ?? null) === DEFAULT_NETWORK_CARD_NAME ? null : (n.card_name ?? null),
                name: n.name,
                mac_address: n.mac_address ?? null,
                ip_address: n.ip_address ?? null,
                site_vlan_id: n.site_vlan_id ?? null,
                nic_type_id: n.nic_type_id ?? null,
                nic_speed_id: n.nic_speed_id ?? null,
                switch_sid_id: n.switch_sid_id ?? null,
                switch_port: n.switch_port ?? null,
              })),
            });

            if (nicsResp.success) {
              setNics(nicsResp.data?.nics ?? []);
            }
          } catch (err) {
            console.error('[Create SID] Failed to save NICs:', err);
            toast.error('SID created, but failed to save NICs. You can edit NICs after opening the SID.');
          }
        }

        // Persist Extra IPs as part of Create SID.
        if (canEdit) {
          try {
            const cleanedExtraIps = normalizeExtraIps(extraIps);
            const ipsResp = await apiClient.replaceSiteSidIpAddresses(siteId, createdSidId, {
              ip_addresses: cleanedExtraIps,
            });

            if (ipsResp.success) {
              setExtraIps(ipsResp.data?.ip_addresses ?? cleanedExtraIps);
            }
          } catch (err) {
            console.error('[Create SID] Failed to save extra IP addresses:', err);
            toast.error('SID created, but failed to save extra IPs. You can edit IPs after opening the SID.');
          }
        }

        navigate(`/sites/${siteId}/sid/${createdSidId}`, {
          state: {
            sidCreatedInSession: true,
            createdSidId,
          },
        });
      } else {
        const resp = await apiClient.updateSiteSid(siteId, sidId, payload);
        if (!resp.success) throw new Error(resp.error || 'Failed to save');

        // Persist NICs as part of Save Edits (no separate "Save NICs" button)
        if (canEdit) {
          const nicsResp = await apiClient.replaceSiteSidNics(siteId, sidId, {
            nics: (nics ?? []).map((n) => ({
              card_name: (n.card_name ?? null) === DEFAULT_NETWORK_CARD_NAME ? null : (n.card_name ?? null),
              name: n.name,
              mac_address: n.mac_address ?? null,
              ip_address: n.ip_address ?? null,
              site_vlan_id: n.site_vlan_id ?? null,
              nic_type_id: n.nic_type_id ?? null,
              nic_speed_id: n.nic_speed_id ?? null,
              switch_sid_id: n.switch_sid_id ?? null,
              switch_port: n.switch_port ?? null,
            })),
          });

          if (!nicsResp.success) throw new Error(nicsResp.error || 'Failed to save NICs');
          setNics(nicsResp.data?.nics ?? []);

          const cleanedExtraIps = normalizeExtraIps(extraIps);
          const ipsResp = await apiClient.replaceSiteSidIpAddresses(siteId, sidId, {
            ip_addresses: cleanedExtraIps,
          });
          if (!ipsResp.success) throw new Error(ipsResp.error || 'Failed to save IP addresses');
          setExtraIps(ipsResp.data?.ip_addresses ?? cleanedExtraIps);
        }

        await reload();
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const details = e.details;
        if (Array.isArray(details) && details.length > 0) {
          const rendered = details
            .map((d: any) => {
              const path = Array.isArray(d?.path) ? d.path.join('.') : String(d?.path ?? '').trim();
              const msg = String(d?.message ?? '').trim();
              if (path && msg) return `${path}: ${msg}`;
              return msg || path || JSON.stringify(d);
            })
            .filter((s) => s)
            .join('; ');
          const message = rendered ? `${e.message}: ${rendered}` : e.message;
          console.error('[Create/Save SID] Validation error:', { message: e.message, details: e.details, response: e.response });
          setSaveError(message);
          return;
        }

        console.error('[Create/Save SID] API error:', { message: e.message, details: e.details, response: e.response });
        setSaveError(e.message);
        return;
      }

      console.error('[Create/Save SID] Error:', e);
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaveLoading(false);
    }
  };

  const deleteSid = async () => {
    if (isCreate) return;
    if (!canEdit) {
      toast.error('Site admin access required');
      return;
    }
    if (isReadOnly) {
      toast.error('SID is already deleted');
      return;
    }

    try {
      setDeleteLoading(true);
      const resp = await apiClient.deleteSiteSid(siteId, sidId);
      if (!resp.success) throw new Error(resp.error || 'Failed to delete SID');

      toast.success('SID deleted');
      shouldLogViewRef.current = false;
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete SID');
    } finally {
      setDeleteLoading(false);
      setDeleteOpen(false);
    }
  };

  const openAddNetworkCardDialog = () => {
    setNewNetworkCardName('');
    setNewNetworkCardError(null);
    setAddNetworkCardOpen(true);
  };

  const addNetworkCardNamed = (cardName: string) => {
    const nextName = String(cardName ?? '').trim();
    if (!nextName) return;
    setNics((prev) => ([
      ...(prev ?? []),
      { card_name: nextName, name: 'NIC1' },
    ]));
    setNetworkingCardTab(nextName);
    setNetworkingNicTab('0');
  };

  const confirmAddNetworkCard = () => {
    const name = String(newNetworkCardName ?? '').trim();
    const existing = new Set((cardNames ?? []).map((c) => String(c ?? '').trim().toLowerCase()));

    if (!name) {
      setNewNetworkCardError('Name is required');
      return;
    }
    if (String(name).trim() === DEFAULT_NETWORK_CARD_NAME) {
      setNewNetworkCardError('That name is reserved');
      return;
    }
    if (existing.has(name.toLowerCase())) {
      setNewNetworkCardError('That card name already exists');
      return;
    }

    setAddNetworkCardOpen(false);
    setNewNetworkCardError(null);
    addNetworkCardNamed(name);
  };

  const removeSelectedNetworkCard = () => {
    const cardToRemove = String(networkingCardTab ?? DEFAULT_NETWORK_CARD_NAME);
    if (cardToRemove === DEFAULT_NETWORK_CARD_NAME) return;

    setPendingNetworkingRemoval({ kind: 'card', cardName: cardToRemove });
  };

  const addNicToSelectedCard = () => {
    const nextNum = (cardNics?.length ?? 0) + 1;
    const nextName = `NIC${nextNum}`;
    const storedCardName = networkingCardTab === DEFAULT_NETWORK_CARD_NAME ? null : networkingCardTab;
    setNics((prev) => ([
      ...(prev ?? []),
      { card_name: storedCardName, name: nextName },
    ]));
    setNetworkingNicTab(String(cardNics.length));
  };

  const removeSelectedNic = () => {
    const selectedIdx = Number(networkingNicTab);
    if (!Number.isFinite(selectedIdx) || selectedIdx < 0 || selectedIdx >= cardNics.length) return;

    const item = cardNics[selectedIdx];
    const nicLabel = String(item?.nic?.name ?? `NIC${selectedIdx + 1}`);

    const oldLen = cardNics.length;
    const nextSelectedIdx = oldLen <= 1 ? 0 : (selectedIdx >= oldLen - 1 ? oldLen - 2 : selectedIdx);

    setPendingNetworkingRemoval({
      kind: 'nic',
      globalNicIndex: item.index,
      nextSelectedNicTab: String(Math.max(0, nextSelectedIdx)),
      label: nicLabel,
    });
  };

  const addNote = async () => {
    if (isCreate) return;
    const text = newNote.trim();
    if (!text) return;

    try {
      setNoteLoading(true);
      setNoteError(null);
      const resp = await apiClient.addSiteSidNote(siteId, sidId, { note_text: text, type: 'NOTE' });
      if (!resp.success) throw new Error(resp.error || 'Failed to add note');
      setNewNote('');
      setNotes((prev) => sortNotesPinnedFirst([resp.data?.note, ...(prev ?? [])].filter(Boolean)));
      setAllowLeave(true);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Failed to add note');
    } finally {
      setNoteLoading(false);
    }
  };

  const setNotePinned = async (noteId: number, pinned: boolean) => {
    try {
      setPinLoadingId(noteId);
      setNoteError(null);

      const resp = await apiClient.setSiteSidNotePinned(siteId, sidId, noteId, pinned);
      if (!resp.success) throw new Error(resp.error || 'Failed to update pin');
      const updated = resp.data?.note;
      if (!updated) return;

      setNotes((prev) => {
        const next = prev.map((n) => (n.id === noteId ? updated : n));
        return sortNotesPinnedFirst(next);
      });
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Failed to update pin');
    } finally {
      setPinLoadingId(null);
    }
  };

  const confirmLeaveWithClosingNote = async () => {
    if (isCreate) return;
    const text = closingNoteText.trim();
    if (!text) {
      setClosingError('Closing note is required');
      return;
    }

    try {
      setClosingLoading(true);
      setClosingError(null);
      const resp = await apiClient.addSiteSidNote(siteId, sidId, { note_text: text, type: 'CLOSING' });
      if (!resp.success) throw new Error(resp.error || 'Failed to add closing note');
      setNotes((prev) => sortNotesPinnedFirst([resp.data?.note, ...(prev ?? [])].filter(Boolean)));
      setAllowLeave(true);
      setClosingOpen(false);
      const pending = pendingNavigation;
      setPendingNavigation(null);
      if (pending?.kind === 'path') {
        navigate(pending.to);
      } else if (pending?.kind === 'back') {
        navigate(-1);
      }
    } catch (e) {
      setClosingError(e instanceof Error ? e.message : 'Failed to add closing note');
    } finally {
      setClosingLoading(false);
    }
  };

  const selectedDeviceModel = React.useMemo(() => {
    const deviceModelId = sid?.device_model_id;
    if (!deviceModelId) return null;
    return deviceModels.find((m) => Number(m?.id) === Number(deviceModelId)) ?? null;
  }, [deviceModels, sid?.device_model_id]);

  const selectedPlatform = React.useMemo(() => {
    const platformId = sid?.platform_id;
    if (!platformId) return null;
    return platforms.find((p) => Number(p?.id) === Number(platformId)) ?? null;
  }, [platforms, sid?.platform_id]);

  const modelSummary = React.useMemo(() => {
    const mfr = (selectedDeviceModel?.manufacturer ?? sid?.device_model_manufacturer ?? '').toString().trim();
    const name = (selectedDeviceModel?.name ?? sid?.device_model_name ?? '').toString().trim();
    if (!mfr && !name) return '';
    if (mfr && name) return `${mfr} — ${name}`;
    return name || mfr;
  }, [selectedDeviceModel, sid?.device_model_manufacturer, sid?.device_model_name]);

  const platformSummary = React.useMemo(() => {
    return (selectedPlatform?.name ?? sid?.platform_name ?? '').toString().trim();
  }, [selectedPlatform, sid?.platform_name]);

  const locationSummary = React.useMemo(() => {
    return (sid?.location_effective_label ?? sid?.location_label ?? '').toString().trim();
  }, [sid?.location_effective_label, sid?.location_label]);

  const onBoardNic1 = React.useMemo(() => {
    const list = Array.isArray(nics) ? nics : [];
    return (
      list.find((n) => {
        const cardName = String(n?.card_name ?? '').trim() || DEFAULT_NETWORK_CARD_NAME;
        const nicName = String(n?.name ?? '').trim().toUpperCase();
        return cardName === DEFAULT_NETWORK_CARD_NAME && nicName === 'NIC1';
      }) ?? null
    );
  }, [nics]);

  const primarySwitchSummary = React.useMemo(() => {
    const switchId = Number(onBoardNic1?.switch_sid_id ?? 0);
    if (!Number.isFinite(switchId) || switchId <= 0) return '';
    return String(switchById.get(switchId)?.hostname ?? '').trim();
  }, [onBoardNic1?.switch_sid_id, switchById]);

  const primaryPortSummary = React.useMemo(() => {
    const value = onBoardNic1?.switch_port;
    if (value == null) return '';
    return String(value).trim();
  }, [onBoardNic1?.switch_port]);

  const primaryVlanSummary = React.useMemo(() => {
    const vlanId = Number(onBoardNic1?.site_vlan_id ?? 0);
    if (!Number.isFinite(vlanId) || vlanId <= 0) return '';
    const vlan = (Array.isArray(vlans) ? vlans : []).find((v) => Number(v?.id) === vlanId);
    if (!vlan) return '';
    const vlanNumber = String(vlan?.vlan_id ?? '').trim();
    const vlanName = String(vlan?.name ?? '').trim();
    if (vlanNumber && vlanName) return `${vlanNumber} — ${vlanName}`;
    return vlanNumber || vlanName;
  }, [onBoardNic1?.site_vlan_id, vlans]);

  const selectedSidTypeName = React.useMemo(() => {
    const sidTypeId = Number(sid?.sid_type_id ?? 0);
    if (!Number.isFinite(sidTypeId) || sidTypeId <= 0) return '';
    const match = (Array.isArray(sidTypes) ? sidTypes : []).find((t) => Number(t?.id) === sidTypeId);
    return String(match?.name ?? '').trim();
  }, [sid?.sid_type_id, sidTypes]);

  const isPatchPanelSidType = React.useMemo(() => {
    return selectedSidTypeName.toLowerCase() === 'patch panel';
  }, [selectedSidTypeName]);

  const missingCreateRequiredFields = React.useMemo(() => {
    if (!isCreate || !sid) return [] as string[];

    const missing: string[] = [];
    if (String(sid.status ?? '').trim() === '') missing.push('Status');
    if (!Number.isFinite(Number(sid.sid_type_id)) || Number(sid.sid_type_id) <= 0) missing.push('SID Type');
    if (!isPatchPanelSidType && String(sid.serial_number ?? '').trim() === '') missing.push('Serial Number');
    if (!Number.isFinite(Number(sid.location_id)) || Number(sid.location_id) <= 0) missing.push('Device Location');
    if (!isPatchPanelSidType && (!Number.isFinite(Number(sid.cpu_count)) || Number(sid.cpu_count) <= 0)) {
      missing.push('CPU Count');
    }
    if (!isPatchPanelSidType && (!Number.isFinite(Number(sid.ram_gb)) || Number(sid.ram_gb) <= 0)) {
      missing.push('RAM (GB)');
    }
    return missing;
  }, [
    isCreate,
    sid,
    sidTypes,
    sid?.status,
    sid?.sid_type_id,
    sid?.serial_number,
    sid?.location_id,
    sid?.cpu_count,
    sid?.ram_gb,
    isPatchPanelSidType,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 mx-auto w-full max-w-6xl">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (error || !sid) {
    return (
      <div className="pt-4 space-y-4 mx-auto w-full max-w-6xl">
        <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}/sid`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to SID Index
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'SID not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-12 space-y-6 mx-auto w-full max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => {
              if (isCreate || allowLeave) {
                navigate(`/sites/${siteId}/sid`);
                return;
              }
              setClosingError(null);
              setClosingNoteText('');
              setPendingNavigation({ kind: 'path', to: `/sites/${siteId}/sid` });
              setClosingOpen(true);
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to SID Index
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {siteName ?? 'Site'} — {isCreate ? 'New SID' : `SID: ${sid.sid_number}`}
            </h1>
            <p className="text-muted-foreground">{isCreate ? 'SID Editor' : 'SID Opened'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isCreate && canEdit && !isReadOnly && (
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={saveLoading || deleteLoading}
            >
              Delete SID
            </Button>
          )}

          <Button
            onClick={() => {
              if (isCreate && missingCreateRequiredFields.length > 0) {
                setSaveError(null);
                setMissingRequiredOpen(true);
                return;
              }
              void saveSid();
            }}
            disabled={
              (isCreate
                ? !canModify
                  || saveLoading
                  || !createPrereqsReady
                : !canModify || saveLoading)
            }
          >
            {saveLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isCreate ? 'Create SID' : 'Save Edits'}
              </>
            )}
          </Button>
        </div>
      </div>

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {isCreate && !createPrereqsReady && (
        <Alert>
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">SID creation is not available yet</div>
              <div className="text-sm text-muted-foreground">
                {canEdit
                  ? `Set up the following before creating a SID: ${missingCreatePrereqs.map((m) => m.label).join(', ')}.`
                  : `Ask a Site Admin to set up the following before creating a SID: ${missingCreatePrereqs.map((m) => m.label).join(', ')}.`}
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {missingCreatePrereqs
                    .filter((m) => m.href)
                    .map((m) => (
                      <Button
                        key={m.key}
                        variant="outline"
                        onClick={() => navigate(m.href!)}
                        disabled={saveLoading}
                      >
                        Go to {m.label}
                      </Button>
                    ))}
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={sid.status ? String(sid.status) : ''}
                onValueChange={(v) => updateSidLocal({ status: v })}
                disabled={!canModify || (isCreate && !createPrereqsReady)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Device Type</Label>
              <Select
                value={sid.sid_type_id ? String(sid.sid_type_id) : ''}
                onValueChange={(v) => updateSidLocal({ sid_type_id: v ? Number(v) : null })}
                disabled={!canModify || (isCreate && !createPrereqsReady)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {sidTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>IP</Label>
              <Input value={(sid.primary_ip ?? '').toString()} disabled />
            </div>

            <div className="space-y-2">
              <Label>Primary Switch</Label>
              <Input value={primarySwitchSummary} disabled />
            </div>

            <div className="space-y-2">
              <Label>Primary Port</Label>
              <Input value={primaryPortSummary} disabled />
            </div>

            <div className="space-y-2">
              <Label>Primary VLAN</Label>
              <Input value={primaryVlanSummary} disabled />
            </div>

            <div className="space-y-2">
              <Label>SID Number</Label>
              <Input value={sid.sid_number ?? ''} disabled />
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input value={modelSummary} disabled />
            </div>

            <div className="space-y-2">
              <Label>Platform</Label>
              <Input value={platformSummary} disabled />
            </div>

            <div className="space-y-2">
              <Label>Hostname</Label>
              <Input value={(sid.hostname ?? '').toString()} disabled />
            </div>

            <div className="space-y-2 md:col-span-2 lg:col-span-3">
              <Label>Location</Label>
              <Input value={locationSummary} disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="main">Main</TabsTrigger>
          <TabsTrigger value="hardware">Hardware</TabsTrigger>
          <TabsTrigger value="software">Software</TabsTrigger>
          <TabsTrigger value="networking">Networking</TabsTrigger>
          <TabsTrigger value="location">Location</TabsTrigger>
        </TabsList>

        <TabsContent value="main">
          <Card>
            <CardHeader>
              <CardTitle>Main Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={mainSubtab} onValueChange={(v) => setMainSubtab(v as any)} className="flex gap-6">
                <TabsList className="flex h-fit w-48 flex-col items-stretch">
                  <TabsTrigger value="notes" className="justify-start">
                    Notes
                  </TabsTrigger>
                  <TabsTrigger value="passwords" className="justify-start" disabled={isCreate}>
                    Passwords
                  </TabsTrigger>
                  <TabsTrigger value="history" className="justify-start" disabled={isCreate}>
                    Update History
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1">
                  <TabsContent value="notes" className="m-0">
                    <div className="space-y-4">
                      {noteError && (
                        <Alert variant="destructive">
                          <AlertDescription>{noteError}</AlertDescription>
                        </Alert>
                      )}

                      <div className="space-y-2">
                        <Label>Add note</Label>
                        <Textarea
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          disabled={noteLoading || isCreate || isReadOnly}
                          placeholder="Write a note for the SID…"
                        />
                        <div className="flex justify-end">
                          <Button onClick={addNote} disabled={noteLoading || isCreate || isReadOnly || newNote.trim() === ''}>
                            {noteLoading ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving…
                              </>
                            ) : (
                              'Add Note'
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {notes.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No notes yet.</div>
                        ) : (
                          notes.map((n) => {
                            const isPinned = isNotePinned(n);
                            const isAdmin = canEdit;
                            const isOwner = user?.id != null && Number(n?.created_by) === Number(user.id);
                            const canPin = isAdmin || isOwner;
                            const canUnpin = isAdmin;

                            return (
                              <div
                                key={n.id}
                                className={
                                  isPinned
                                    ? 'rounded-md border border-primary/30 bg-primary/10 p-3 mb-3'
                                    : 'rounded-md border p-3'
                                }
                              >
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <div className={isPinned ? 'font-semibold' : 'font-medium'}>
                                    {formatNoteHeader(n.created_at, n.created_by_username)}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isPinned ? (
                                      canUnpin ? (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => setNotePinned(n.id, false)}
                                          disabled={pinLoadingId === n.id || isReadOnly}
                                          title="Unpin"
                                        >
                                          <PinOff className="h-4 w-4" />
                                        </Button>
                                      ) : (
                                        <div className="text-muted-foreground" title="Pinned">
                                          <Pin className="h-4 w-4" />
                                        </div>
                                      )
                                    ) : canPin ? (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setNotePinned(n.id, true)}
                                        disabled={pinLoadingId === n.id || isReadOnly}
                                        title="Pin"
                                      >
                                        <Pin className="h-4 w-4" />
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                <div className={isPinned ? 'mt-2 whitespace-pre-wrap text-sm font-semibold' : 'mt-2 whitespace-pre-wrap text-sm'}>
                                  {n.note_text}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="passwords" className="m-0">
                    <div className="space-y-4">
                      {passwordError && (
                        <Alert variant="destructive">
                          <AlertDescription>{passwordError}</AlertDescription>
                        </Alert>
                      )}

                      {passwordMode === 'legacy' ? (
                        passwordMeta ? (
                          <div className="text-sm text-muted-foreground">
                            {passwordMeta?.password_updated_at ? (
                              <div>
                                Last updated: {new Date(passwordMeta.password_updated_at).toLocaleString()} by {passwordMeta.password_updated_by_username ?? 'Unknown'}
                              </div>
                            ) : (
                              <div>No saved login details yet.</div>
                            )}
                            <div>
                              Password saved: {passwordMeta?.has_password ? 'Yes' : 'No'}
                            </div>
                            {passwordMeta?.key_configured === false && (
                              <div>
                                Encryption key is not configured on the server.
                              </div>
                            )}
                          </div>
                        ) : null
                      ) : (
                        <>
                          {passwordMeta?.key_configured === false && (
                            <div className="text-sm text-muted-foreground">
                              Encryption key is not configured on the server.
                            </div>
                          )}

                          {passwordTypes.length === 0 ? (
                            <div className="rounded-md border p-3">
                              <div className="text-sm font-medium">No password types configured</div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {canEdit
                                  ? 'Create Password Types so users can save logins for OS, iDRAC/iLO, switches, etc.'
                                  : 'Ask a Site Admin to create Password Types so you can save logins for OS, iDRAC/iLO, switches, etc.'}
                              </div>
                              {canEdit && (
                                <div className="mt-3">
                                  <Button
                                    variant="outline"
                                    onClick={() => navigate(`/sites/${siteId}/sid/admin?tab=passwordTypes`)}
                                    disabled={passwordLoading || passwordSaving}
                                  >
                                    Go to Password Types
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}

                      {passwordMode === 'legacy' && (
                        <>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Username</Label>
                              <Input
                                value={passwordUsername}
                                disabled={!canEditWrite || passwordLoading || passwordSaving}
                                onChange={(e) => setPasswordUsername(e.target.value)}
                                placeholder="e.g. Administrator"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Password</Label>
                              <Input
                                type="password"
                                value={passwordValue}
                                disabled={!canEditWrite || passwordLoading || passwordSaving}
                                onChange={(e) => setPasswordValue(e.target.value)}
                                placeholder="Enter to overwrite"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <Button onClick={saveLegacyPassword} disabled={!canEditWrite || passwordLoading || passwordSaving}>
                              {passwordSaving ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Saving…
                                </>
                              ) : (
                                'Save Login Details'
                              )}
                            </Button>
                          </div>
                        </>
                      )}

                      {passwordMode === 'typed' && passwordTypes.length > 0 && (
                        <>
                          <div className="flex justify-end">
                            <Button
                              onClick={() => {
                                setPasswordError(null);
                                setCreatePasswordTypeId('');
                                setCreatePasswordUsername('');
                                setCreatePasswordValue('');
                                setCreatePasswordOpen(true);
                              }}
                              disabled={!canEditWrite || passwordLoading || passwordSaving || unusedPasswordTypes.length === 0}
                            >
                              Add Password
                            </Button>
                          </div>

                          {savedPasswordRows.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              No passwords saved yet.
                            </div>
                          ) : (
                            <div className="rounded-md border p-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Username</TableHead>
                                    <TableHead>Password</TableHead>
                                    <TableHead>Last Updated</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {savedPasswordRows.map((row: any, idx: number) => (
                                    <TableRow key={`${row?.password_type_id ?? 't'}-${idx}`}>
                                      <TableCell className="font-medium">{row?.password_type_name ?? 'Password'}</TableCell>
                                      <TableCell>{row?.username ? String(row.username) : '—'}</TableCell>
                                      <TableCell className="font-mono break-all">
                                        {row?.password ? String(row.password) : (row?.has_password ? 'Saved' : '—')}
                                      </TableCell>
                                      <TableCell>{row?.password_updated_at ? new Date(row.password_updated_at).toLocaleString() : '—'}</TableCell>
                                      <TableCell className="text-right">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => openEditPasswordDialog(row)}
                                          disabled={!canEditWrite || passwordLoading || passwordSaving}
                                          title="Edit"
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}

                          <Dialog open={createPasswordOpen} onOpenChange={setCreatePasswordOpen}>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Add Password</DialogTitle>
                                <DialogDescription>
                                  Select a password type and save a username/password for this SID.
                                </DialogDescription>
                              </DialogHeader>

                              <div className="space-y-4">
                                <div className="space-y-2">
                                  <Label>Password Type</Label>
                                  <Select
                                    value={createPasswordTypeId}
                                    onValueChange={(v) => setCreatePasswordTypeId(v)}
                                    disabled={!canEditWrite || passwordLoading || passwordSaving}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select password type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {unusedPasswordTypes.map((t) => (
                                        <SelectItem key={t.id} value={String(t.id)}>
                                          {t.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <Label>Username</Label>
                                  <Input
                                    value={createPasswordUsername}
                                    disabled={!canEditWrite || passwordLoading || passwordSaving}
                                    onChange={(e) => setCreatePasswordUsername(e.target.value)}
                                    placeholder="e.g. Administrator"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label>Password</Label>
                                  <Input
                                    type="password"
                                    value={createPasswordValue}
                                    disabled={!canEditWrite || passwordLoading || passwordSaving}
                                    onChange={(e) => setCreatePasswordValue(e.target.value)}
                                    placeholder="Enter password"
                                  />
                                </div>
                              </div>

                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setCreatePasswordOpen(false)}
                                  disabled={passwordSaving}
                                >
                                  Cancel
                                </Button>
                                <Button onClick={addTypedPassword} disabled={passwordSaving}>
                                  {passwordSaving ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    'Save Password'
                                  )}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <Dialog open={editPasswordOpen} onOpenChange={setEditPasswordOpen}>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Password</DialogTitle>
                                <DialogDescription>
                                  Update {editPasswordTypeName || 'Password'} for this SID.
                                </DialogDescription>
                              </DialogHeader>

                              <div className="space-y-4">
                                <div className="space-y-2">
                                  <Label>Username</Label>
                                  <Input
                                    value={editPasswordUsername}
                                    disabled={!canEditWrite || passwordLoading || passwordSaving}
                                    onChange={(e) => setEditPasswordUsername(e.target.value)}
                                    placeholder="e.g. Administrator"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label>Password</Label>
                                  <Input
                                    type="password"
                                    value={editPasswordValue}
                                    disabled={!canEditWrite || passwordLoading || passwordSaving}
                                    onChange={(e) => setEditPasswordValue(e.target.value)}
                                    placeholder="Leave blank to keep current"
                                  />
                                </div>
                              </div>

                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setEditPasswordOpen(false)}
                                  disabled={passwordSaving}
                                >
                                  Cancel
                                </Button>
                                <Button onClick={saveEditedTypedPassword} disabled={passwordSaving}>
                                  {passwordSaving ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    'Save Changes'
                                  )}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="history" className="m-0">
                    <div className="space-y-4">
                      {historyError && (
                        <Alert variant="destructive">
                          <AlertDescription>{historyError}</AlertDescription>
                        </Alert>
                      )}

                      {historyLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading history…
                        </div>
                      ) : history.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No history yet.</div>
                      ) : (
                        <div className="space-y-3">
                          {history.map((h) => {
                            let diff: any = null;
                            try {
                              diff = h?.diff_json ? JSON.parse(h.diff_json) : null;
                            } catch {
                              diff = null;
                            }

                            const changeList = Array.isArray(diff?.changes) ? diff.changes : (Array.isArray(diff?.changes?.changes) ? diff.changes.changes : null);

                            const renderedChanges = Array.isArray(changeList)
                              ? changeList
                                  .filter((c: any) => c && typeof c.field === 'string')
                                  .map((c: any) => ({
                                    field: c.field,
                                    from: c.from,
                                    to: c.to,
                                  }))
                              : null;

                            return (
                              <div key={h.id} className="rounded-md border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <div className="font-medium">
                                    {new Date(h.created_at).toLocaleString()} — {h.actor_username ?? 'Unknown'}
                                  </div>
                                  <div className="text-muted-foreground">{h.action}</div>
                                </div>
                                <div className="mt-1 text-sm">{h.summary}</div>

                                {renderedChanges && renderedChanges.length > 0 && (
                                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                    {renderedChanges.map((c: any, idx: number) => (
                                      <div key={`${h.id}-${idx}`}>
                                        {formatHistoryFieldLabel(c.field)}: {String(c.from ?? '')} → {String(c.to ?? '')}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hardware">
          <Card>
            <CardHeader>
              <CardTitle>Hardware</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={hardwareSubtab} onValueChange={(v) => setHardwareSubtab(v as any)} className="flex gap-6">
                <TabsList className="flex h-fit w-48 flex-col items-stretch">
                  <TabsTrigger value="configuration" className="justify-start">
                    Configuration
                  </TabsTrigger>
                  <TabsTrigger value="parts" className="justify-start">
                    Parts
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1">
                  <TabsContent value="configuration" className="m-0">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Device Model</Label>
                        <Select
                          value={sid.device_model_id ? String(sid.device_model_id) : ''}
                          onValueChange={(v) => {
                            const nextId = v ? Number(v) : null;
                            const model = deviceModels.find((m) => Number(m?.id) === Number(nextId));
                            const isSwitchModel = model?.is_switch === true || Number(model?.is_switch ?? 0) === 1;
                            const defaultPorts = Number(model?.default_switch_port_count ?? 0);

                            updateSidLocal({
                              device_model_id: nextId,
                              device_model_manufacturer: model?.manufacturer ?? null,
                              device_model_name: model?.name ?? null,
                              device_model_is_switch: isSwitchModel,
                              switch_port_count:
                                nextId && isSwitchModel
                                  ? Number.isFinite(defaultPorts) && defaultPorts > 0
                                    ? defaultPorts
                                    : null
                                  : null,
                            });
                          }}
                          disabled={!canModify || (isCreate && !createPrereqsReady)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select device model" />
                          </SelectTrigger>
                          <SelectContent>
                            {deviceModels.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.manufacturer ? `${m.manufacturer} — ${m.name}` : m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>CPU Model</Label>
                        <Select
                          value={sid.cpu_model_id ? String(sid.cpu_model_id) : ''}
                          onValueChange={(v) => {
                            const nextId = v ? Number(v) : null;
                            const model = cpuModels.find((m) => Number(m?.id) === Number(nextId));
                            updateSidLocal({
                              cpu_model_id: nextId,
                              cpu_cores: model?.cpu_cores ?? sid.cpu_cores ?? null,
                              cpu_threads: model?.cpu_threads ?? sid.cpu_threads ?? null,
                            });
                          }}
                          disabled={!canModify || (isCreate && !createPrereqsReady)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select CPU model" />
                          </SelectTrigger>
                          <SelectContent>
                            {cpuModels.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.manufacturer ? `${m.manufacturer} — ${m.name}` : m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Serial Number</Label>
                        <Input
                          value={sid.serial_number ?? ''}
                          disabled={!canModify || (isCreate && !createPrereqsReady)}
                          onChange={(e) => updateSidLocal({ serial_number: e.target.value })}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>CPU Count</Label>
                        <Input
                          type="number"
                          value={sid.cpu_count ?? ''}
                          disabled={!canModify || (isCreate && !createPrereqsReady)}
                          onChange={(e) => updateSidLocal({ cpu_count: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>CPU Cores</Label>
                        <Input
                          type="number"
                          value={sid.cpu_cores ?? ''}
                          disabled
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>CPU Threads</Label>
                        <Input
                          type="number"
                          value={sid.cpu_threads ?? ''}
                          disabled
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>RAM (GB)</Label>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          value={sid.ram_gb ?? ''}
                          disabled={!canModify || (isCreate && !createPrereqsReady)}
                          onChange={(e) => {
                            const t = e.target.value;
                            updateSidLocal({ ram_gb: t === '' ? null : Number.parseFloat(t) });
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="parts" className="m-0">
                    <div className="text-sm text-muted-foreground">
                      Parts will attach Stock IDs here (coming soon).
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="software">
          <Card>
            <CardHeader>
              <CardTitle>Software</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select
                    value={sid.platform_id ? String(sid.platform_id) : ''}
                    onValueChange={(v) => {
                      const nextId = v ? Number(v) : null;
                      const platform = platforms.find((p) => Number(p?.id) === Number(nextId));
                      updateSidLocal({ platform_id: nextId, platform_name: platform?.name ?? sid.platform_name ?? null });
                    }}
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {platforms.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>OS Name</Label>
                  <Input
                    value={sid.os_name ?? ''}
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                    onChange={(e) => updateSidLocal({ os_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>OS Version</Label>
                  <Input
                    value={sid.os_version ?? ''}
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                    onChange={(e) => updateSidLocal({ os_version: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="networking">
          <Card>
            <CardHeader>
              <CardTitle>Networking</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={networkingSubtab} onValueChange={(v) => setNetworkingSubtab(v as any)}>
                <div className="flex items-start gap-4">
                  <TabsList className="flex h-auto w-[200px] flex-col items-stretch self-start">
                    <TabsTrigger value="configuration" className="justify-start">Configuration</TabsTrigger>
                    <TabsTrigger value="ip_addresses" className="justify-start">IP Addresses</TabsTrigger>
                  </TabsList>

                  <div className="min-w-0 flex-1">
                    <TabsContent value="configuration" className="m-0">
                      <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Hostname</Label>
                            <Input
                              value={sid.hostname ?? ''}
                              disabled={!canModify || (isCreate && !createPrereqsReady)}
                              onChange={(e) => updateSidLocal({ hostname: e.target.value })}
                            />
                          </div>
                        </div>

                        <Tabs
                          value={networkingCardTab}
                          onValueChange={(v) => {
                            if (v === '__newcard') return;
                            setNetworkingCardTab(v);
                            setNetworkingNicTab('0');
                          }}
                        >
                          <div className="flex items-start gap-4">
                            <TabsList className="flex h-auto w-[240px] flex-col items-stretch self-start">
                              {cardNames.map((c) => (
                                <TabsTrigger key={c} value={c} className="justify-start">
                                  {c}
                                </TabsTrigger>
                              ))}
                              <TabsTrigger
                                value="__newcard"
                                className="justify-start"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.preventDefault();
                                  openAddNetworkCardDialog();
                                }}
                                disabled={!canModify || (isCreate && !createPrereqsReady)}
                              >
                                New +
                              </TabsTrigger>
                            </TabsList>

                            <div className="min-w-0 flex-1">
                              <div className="flex justify-end pb-2">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={removeSelectedNetworkCard}
                                  disabled={!canModify || (isCreate && !createPrereqsReady) || networkingCardTab === DEFAULT_NETWORK_CARD_NAME}
                                >
                                  Remove Card
                                </Button>
                              </div>

                              <Tabs
                                value={networkingNicTab}
                                onValueChange={(v) => {
                                  if (v === '__newnic') return;
                                  setNetworkingNicTab(v);
                                }}
                              >
                                <TabsList className="flex flex-wrap justify-start">
                                  {cardNics.map((item, idx) => (
                                    <TabsTrigger key={`${item.index}-${idx}`} value={String(idx)}>
                                      {String(item.nic?.name ?? `NIC${idx + 1}`)}
                                    </TabsTrigger>
                                  ))}
                                  <TabsTrigger
                                    value="__newnic"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      addNicToSelectedCard();
                                    }}
                                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                                  >
                                    +
                                  </TabsTrigger>
                                </TabsList>

                                {cardNics.length === 0 ? (
                                  <div className="mt-4 text-sm text-muted-foreground">No NICs.</div>
                                ) : (
                                  cardNics.map((item, idx) => {
                                    const nic = item.nic;
                                    const selectedSwitch = nic?.switch_sid_id ? switchById.get(Number(nic.switch_sid_id)) : null;
                                    const portCount = Number(selectedSwitch?.switch_port_count ?? nic?.switch_port_count ?? 0);
                                    const ports = Number.isFinite(portCount) && portCount > 0
                                      ? Array.from({ length: Math.min(4096, portCount) }, (_, i) => String(i + 1))
                                      : [];

                                    return (
                                      <TabsContent key={`${item.index}-${idx}`} value={String(idx)} className="m-0 pt-4">
                                        <div className="flex justify-end pb-4">
                                          <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={removeSelectedNic}
                                            disabled={!canModify || (isCreate && !createPrereqsReady)}
                                          >
                                            Remove NIC
                                          </Button>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-3">
                                          <div className="space-y-2">
                                            <Label>Switch Name</Label>
                                            <Select
                                              value={nic?.switch_sid_id ? String(nic.switch_sid_id) : ''}
                                              onValueChange={(v) => {
                                                const nextId = v ? Number(v) : null;
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, switch_sid_id: nextId, switch_port: null } : p)));
                                              }}
                                              disabled={!canEdit}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder="None" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {switchSids.map((s) => (
                                                  <SelectItem key={s.id} value={String(s.id)}>
                                                    {String(s.hostname ?? '').trim()}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-2">
                                            <Label>Switch Port</Label>
                                            <Select
                                              value={nic?.switch_port ? String(nic.switch_port) : ''}
                                              onValueChange={(v) => {
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, switch_port: v || null } : p)));
                                              }}
                                              disabled={!canEdit || !nic?.switch_sid_id || ports.length === 0}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder={ports.length ? 'Select port' : 'No ports'} />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {ports.map((p) => (
                                                  <SelectItem key={p} value={p}>
                                                    {p}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-2">
                                            <Label>Switch VLAN</Label>
                                            <Select
                                              value={nic?.site_vlan_id ? String(nic.site_vlan_id) : ''}
                                              onValueChange={(v) => {
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, site_vlan_id: v ? Number(v) : null } : p)));
                                              }}
                                              disabled={!canEdit}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder="None" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {vlans.map((v) => (
                                                  <SelectItem key={v.id} value={String(v.id)}>
                                                    {v.vlan_id} — {v.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-2">
                                            <Label>MAC Address</Label>
                                            <Input
                                              value={nic?.mac_address ?? ''}
                                              disabled={!canEdit}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, mac_address: v } : p)));
                                              }}
                                            />
                                          </div>

                                          <div className="space-y-2">
                                            <Label>NIC Type</Label>
                                            <Select
                                              value={nic?.nic_type_id ? String(nic.nic_type_id) : ''}
                                              onValueChange={(v) => {
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, nic_type_id: v ? Number(v) : null } : p)));
                                              }}
                                              disabled={!canEdit}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder="None" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {nicTypes.map((t) => (
                                                  <SelectItem key={t.id} value={String(t.id)}>
                                                    {t.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-2">
                                            <Label>NIC Speed</Label>
                                            <Select
                                              value={nic?.nic_speed_id ? String(nic.nic_speed_id) : ''}
                                              onValueChange={(v) => {
                                                setNics((prev) => prev.map((p, i) => (i === item.index ? { ...p, nic_speed_id: v ? Number(v) : null } : p)));
                                              }}
                                              disabled={!canEdit}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder="None" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {nicSpeeds.map((s) => (
                                                  <SelectItem key={s.id} value={String(s.id)}>
                                                    {s.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                      </TabsContent>
                                    );
                                  })
                                )}
                              </Tabs>
                            </div>
                          </div>
                        </Tabs>
                      </div>
                    </TabsContent>

                    <TabsContent value="ip_addresses" className="m-0">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Primary IP</Label>
                          <Input
                            value={(sid?.primary_ip ?? '').toString()}
                            disabled={!canModify || (isCreate && !createPrereqsReady)}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateSidLocal({ primary_ip: v.trim() === '' ? null : v });
                            }}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Subnet IP</Label>
                          <Input
                            value={(sid?.subnet_ip ?? '').toString()}
                            disabled={!canModify || (isCreate && !createPrereqsReady)}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateSidLocal({ subnet_ip: v.trim() === '' ? null : v });
                            }}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Gateway IP</Label>
                          <Input
                            value={(sid?.gateway_ip ?? '').toString()}
                            disabled={!canModify || (isCreate && !createPrereqsReady)}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateSidLocal({ gateway_ip: v.trim() === '' ? null : v });
                            }}
                          />
                        </div>

                        <div className="space-y-3 md:col-span-3">
                          <div className="flex items-center justify-between gap-2">
                            <Label>Extra IPs</Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!canModify || (isCreate && !createPrereqsReady)}
                              onClick={() => setExtraIps((prev) => [...(Array.isArray(prev) ? prev : []), ''])}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add Extra IP
                            </Button>
                          </div>

                          {extraIps.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No extra IPs added.</div>
                          ) : (
                            <div className="space-y-2">
                              {extraIps.map((value, idx) => (
                                <div key={`extra-ip-${idx}`} className="flex items-center gap-2">
                                  <Input
                                    value={value}
                                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                                    placeholder={`Extra IP ${idx + 1}`}
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setExtraIps((prev) => {
                                        const next = Array.isArray(prev) ? prev.slice() : [];
                                        next[idx] = nextValue;
                                        return next;
                                      });
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                                    aria-label={`Remove Extra IP ${idx + 1}`}
                                    onClick={() => {
                                      const label = `Extra IP ${idx + 1}`;
                                      const ipText = String(value ?? '').trim();
                                      setPendingExtraIpRemoval({ index: idx, label, ipText });
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="text-xs text-muted-foreground">{extraIpCount} extra IP(s)</div>
                        </div>
                      </div>
                    </TabsContent>
                  </div>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="location">
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Device Location</Label>
                  <LocationHierarchyDropdown
                    locations={locations}
                    valueLocationId={sid.location_id ? Number(sid.location_id) : null}
                    placeholder="Unassigned"
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                    onSelect={(id) => updateSidLocal({ location_id: Number(id) })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Power</Label>
                  <Input
                    type="text"
                    value={(sid.pdu_power ?? '').toString()}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateSidLocal({ pdu_power: v.trim() === '' ? null : v });
                    }}
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                    placeholder="e.g. PDU-A1/12"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Rack Entry</Label>
                  <Input
                    type="text"
                    value={(sid.rack_u ?? '').toString()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const cleaned = raw.replace(/^u\s*/i, '');
                      updateSidLocal({ rack_u: cleaned.trim() === '' ? null : cleaned });
                    }}
                    disabled={!canModify || (isCreate && !createPrereqsReady)}
                    placeholder="e.g. 12a"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={closingOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPendingNavigation(null);
            setClosingOpen(false);
          } else {
            setClosingOpen(true);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Closing Note Required</DialogTitle>
            <DialogDescription>
              You must leave a closing note before closing this SID.
            </DialogDescription>
          </DialogHeader>

          {closingError && (
            <Alert variant="destructive">
              <AlertDescription>{closingError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Closing note</Label>
            <Textarea
              value={closingNoteText}
              onChange={(e) => setClosingNoteText(e.target.value)}
              placeholder="What changed? Why? Any follow-up needed?"
              disabled={closingLoading}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingNavigation(null);
                setClosingOpen(false);
              }}
              disabled={closingLoading}
            >
              Stay
            </Button>
            <Button onClick={confirmLeaveWithClosingNote} disabled={closingLoading}>
              {closingLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save and Leave'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={addNetworkCardOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddNetworkCardOpen(false);
            setNewNetworkCardError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Network Card</DialogTitle>
            <DialogDescription>
              Enter a descriptive card name (e.g., Intel X520).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="new-network-card-name">Name</Label>
            <Input
              id="new-network-card-name"
              value={newNetworkCardName}
              onChange={(e) => {
                setNewNetworkCardName(e.target.value);
                setNewNetworkCardError(null);
              }}
              disabled={!canModify || (isCreate && !createPrereqsReady)}
              placeholder="e.g., Intel X520"
            />
            {newNetworkCardError ? (
              <div className="text-sm text-destructive">{newNetworkCardError}</div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddNetworkCardOpen(false);
                setNewNetworkCardError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmAddNetworkCard}
              disabled={!canModify || (isCreate && !createPrereqsReady)}
            >
              Add Card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={missingRequiredOpen}
        onOpenChange={(open) => {
          if (!open) setMissingRequiredOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Missing required fields</AlertDialogTitle>
            <AlertDialogDescription>
              Fill in the following fields before creating this SID:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="text-sm">
            <ul className="list-disc pl-5 space-y-1">
              {missingCreateRequiredFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setMissingRequiredOpen(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this SID? It will not be removed; its status will be set to "Deleted" and it will become read-only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void deleteSid();
              }}
              disabled={deleteLoading}
            >
              {deleteLoading ? 'Deleting…' : 'Delete SID'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingExtraIpRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingExtraIpRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm removal</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingExtraIpRemoval?.ipText
                ? `Remove ${pendingExtraIpRemoval.label} (${pendingExtraIpRemoval.ipText}) from this SID?`
                : `Remove ${pendingExtraIpRemoval?.label ?? 'this Extra IP'} from this SID?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const pending = pendingExtraIpRemoval;
                setPendingExtraIpRemoval(null);
                if (!pending) return;
                setExtraIps((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== pending.index) : []));
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingNetworkingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNetworkingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm removal</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingNetworkingRemoval?.kind === 'card'
                ? `Remove network card "${pendingNetworkingRemoval.cardName}" and all its NICs?`
                : pendingNetworkingRemoval?.kind === 'nic'
                  ? `Remove ${pendingNetworkingRemoval.label}?`
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();

                const pending = pendingNetworkingRemoval;
                setPendingNetworkingRemoval(null);
                if (!pending) return;

                if (pending.kind === 'card') {
                  const cardToRemove = pending.cardName;
                  setNics((prev) => {
                    const list = Array.isArray(prev) ? prev : [];
                    return list.filter((n) => {
                      const raw = String(n?.card_name ?? '').trim();
                      const display = raw || DEFAULT_NETWORK_CARD_NAME;
                      return display !== cardToRemove;
                    });
                  });
                  setNetworkingCardTab(DEFAULT_NETWORK_CARD_NAME);
                  setNetworkingNicTab('0');
                  return;
                }

                if (pending.kind === 'nic') {
                  setNics((prev) => {
                    const list = Array.isArray(prev) ? prev : [];
                    return list.filter((_, i) => i !== pending.globalNicIndex);
                  });
                  setNetworkingNicTab(pending.nextSelectedNicTab);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SidDetailPage;
