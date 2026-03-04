import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Search } from 'lucide-react';

import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import usePermissions from '../hooks/usePermissions';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
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
import { Switch } from '../components/ui/switch';

const SiteSidIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const siteId = Number(params.siteId);
  const permissions = usePermissions();
  const { user, memberships } = useAuth();
  const canEdit = permissions.canAdministerSite(siteId);

  const canCreateSid = Boolean(
    user &&
      (user.role === 'GLOBAL_ADMIN' || (memberships ?? []).some((m) => Number(m.site_id) === siteId))
  );

  const [siteName, setSiteName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState('');
  const [searchField, setSearchField] = React.useState<'status' | 'sid' | 'location' | 'hostname' | 'model' | 'ip' | 'cpu' | 'power' | 'switch_name'>('sid');
  const [matchExact, setMatchExact] = React.useState(false);
  const [showDeleted, setShowDeleted] = React.useState(false);
  const [sids, setSids] = React.useState<any[]>([]);
  const [sidsLoading, setSidsLoading] = React.useState(false);
  const [sidsError, setSidsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const load = async () => {
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
        setSiteName(resp.data.site.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load site');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [siteId]);

  React.useEffect(() => {
    if (!Number.isFinite(siteId) || siteId <= 0) return;

    const timeout = setTimeout(() => {
      const run = async () => {
        try {
          setSidsLoading(true);
          setSidsError(null);
          const resp = await apiClient.getSiteSids(siteId, {
            search: search.trim() || undefined,
            search_field: searchField,
            exact: matchExact,
            show_deleted: showDeleted,
            limit: 200,
            offset: 0,
          });
          if (!resp.success) throw new Error(resp.error || 'Failed to load SIDs');
          setSids(resp.data?.sids ?? []);
        } catch (e) {
          setSidsError(e instanceof Error ? e.message : 'Failed to load SIDs');
        } finally {
          setSidsLoading(false);
        }
      };

      run();
    }, 250);

    return () => clearTimeout(timeout);
  }, [siteId, search, searchField, matchExact, showDeleted]);

  const formatRackEntry = (sid: any): string => {
    const raw = sid?.rack_u;
    if (raw === null || raw === undefined || raw === '') return '—';
    const cleaned = String(raw).trim().replace(/^u\s*/i, '').trim();
    if (!cleaned) return '—';
    return cleaned;
  };

  const formatSidLocation = (sid: any): string => {
    const label = (sid?.location_effective_label ?? '').toString().trim();
    if (!label) return '—';

    const floorRaw = (sid?.location_floor ?? '').toString().trim();
    const suiteRaw = (sid?.location_suite ?? '').toString().trim();
    const rowRaw = (sid?.location_row ?? '').toString().trim();
    const rackRaw = (sid?.location_rack ?? '').toString().trim();
    const area = (sid?.location_area ?? '').toString().trim();
    const template = (sid?.location_template_type ?? '').toString().trim().toUpperCase();

    const withPrefix = (prefix: string, value: string) => {
      const v = value.trim();
      if (!v) return '';
      const up = v.toUpperCase();
      if (up.startsWith(prefix.toUpperCase())) return v;
      return `${prefix}${v}`;
    };

    const floor = withPrefix('FL', floorRaw);
    const suite = withPrefix('S', suiteRaw);
    const row = withPrefix('ROW', rowRaw);
    const rackWithoutRackSize = rackRaw
      .replace(/\s*\|\s*Rack\s*Size\s*:\s*[^|]+/gi, '')
      .replace(/\s*Rack\s*Size\s*:\s*\d+\s*U\s*$/gi, '')
      .trim();
    const rack = withPrefix('R', rackWithoutRackSize);

    const isDomestic = template === 'DOMESTIC' || (area !== '' && suite === '' && row === '' && rack === '');
    if (isDomestic) {
      return [label, floor, area].filter((p) => p !== '').join('/');
    }

    return [label, floor, suite, row, rack].filter((p) => p !== '').join('/');
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
      <div className="pt-4 space-y-4">
        <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Site Hub
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-6 mx-auto w-full max-w-6xl xl:max-w-[96rem] 2xl:max-w-[112rem]">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Site Hub
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{siteName ?? 'Site'}</h1>
            <p className="text-muted-foreground">SIDIndex</p>
          </div>
        </div>

        {canCreateSid && (
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                onClick={() => navigate(`/sites/${siteId}/sid/admin`)}
              >
                SID Admin
              </Button>
            )}
            <Button onClick={() => navigate(`/sites/${siteId}/sid/new`)}>
              <Plus className="mr-2 h-4 w-4" />
              Create SID
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SID Index Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm font-medium">Filter</div>
            <div className="flex items-center gap-2">
              <div className="w-[220px]">
                <Select value={searchField} onValueChange={(v) => setSearchField(v as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Search field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="sid">SID</SelectItem>
                    <SelectItem value="location">Rack Location</SelectItem>
                    <SelectItem value="hostname">Hostname</SelectItem>
                    <SelectItem value="model">Model</SelectItem>
                    <SelectItem value="ip">IP</SelectItem>
                    <SelectItem value="cpu">CPU</SelectItem>
                    <SelectItem value="power">Power</SelectItem>
                    <SelectItem value="switch_name">Switch Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search by ${
                    searchField === 'sid'
                      ? 'SID'
                      : searchField === 'location'
                        ? 'Rack Location'
                        : searchField === 'switch_name'
                          ? 'Switch Name'
                        : searchField.charAt(0).toUpperCase() + searchField.slice(1)
                  }…`}
                  className="pl-8"
                />
              </div>

              <div className="flex items-center gap-2 pl-2">
                <div className="text-sm text-muted-foreground">Match Exact</div>
                <Switch
                  checked={matchExact}
                  onCheckedChange={(v) => setMatchExact(Boolean(v))}
                  aria-label="Match exact"
                />
              </div>

              <div className="flex items-center gap-2 pl-2">
                <div className="text-sm text-muted-foreground">Show Deleted</div>
                <Switch
                  checked={showDeleted}
                  onCheckedChange={(v) => setShowDeleted(Boolean(v))}
                  aria-label="Show deleted"
                />
              </div>
            </div>

            {searchField === 'sid' && (
              <div className="text-xs text-muted-foreground">
                Tip: Search multiple SIDs by separating with commas (e.g. 1215, 1256, 156315).
              </div>
            )}

            {sidsError && (
              <Alert variant="destructive">
                <AlertDescription>{sidsError}</AlertDescription>
              </Alert>
            )}

            {sidsLoading ? (
              <div className="flex items-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading SIDs…
              </div>
            ) : sids.length === 0 ? (
              <div className="py-6 text-sm text-muted-foreground">No SIDs found.</div>
            ) : (
              <Table className="lg:[&_th]:whitespace-nowrap lg:[&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>SID</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Rack Entry</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>CPU</TableHead>
                    <TableHead>Power</TableHead>
                    <TableHead>Switch Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sids.map((sid) => (
                    <TableRow
                      key={sid.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/sites/${siteId}/sid/${sid.id}`)}
                    >
                      <TableCell>{sid.status || '—'}</TableCell>
                      <TableCell className="font-medium">{sid.sid_number}</TableCell>
                      <TableCell>{formatSidLocation(sid)}</TableCell>
                      <TableCell>{formatRackEntry(sid)}</TableCell>
                      <TableCell>{sid.hostname || '—'}</TableCell>
                      <TableCell>{(sid.primary_ip ?? '').toString().trim() || '—'}</TableCell>
                      <TableCell>
                        {sid.device_model_name
                          ? sid.device_model_manufacturer
                            ? `${sid.device_model_manufacturer} — ${sid.device_model_name}`
                            : sid.device_model_name
                          : '—'}
                      </TableCell>
                      <TableCell>{(sid.cpu_model_name ?? '').toString().trim() || '—'}</TableCell>
                      <TableCell>{(sid.pdu_power ?? '').toString().trim() || '—'}</TableCell>
                      <TableCell>{(sid.primary_switch_hostname ?? '').toString().trim() || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
};

export default SiteSidIndexPage;
