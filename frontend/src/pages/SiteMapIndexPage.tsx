import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';
import type { MapCableTraceHop, MapRackElevation, MapRackOption } from '../types';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import RackElevationGrid from '../components/mapindex/RackElevationGrid';
import CableTraceView from '../components/mapindex/CableTraceView';

const SiteMapIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const siteId = Number(params.siteId);

  const [siteName, setSiteName] = React.useState<string | null>(null);
  const [loadingSite, setLoadingSite] = React.useState(true);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const [activeTab, setActiveTab] = React.useState<'rack' | 'trace'>('rack');

  const [rackQuery, setRackQuery] = React.useState('');
  const [rackOptions, setRackOptions] = React.useState<MapRackOption[]>([]);
  const [selectedRackIds, setSelectedRackIds] = React.useState<number[]>([]);
  const [loadingRackOptions, setLoadingRackOptions] = React.useState(false);
  const [loadingRacks, setLoadingRacks] = React.useState(false);
  const [rackError, setRackError] = React.useState<string | null>(null);
  const [rackElevations, setRackElevations] = React.useState<MapRackElevation[]>([]);

  const [cableRefInput, setCableRefInput] = React.useState('');
  const [loadingTrace, setLoadingTrace] = React.useState(false);
  const [traceError, setTraceError] = React.useState<string | null>(null);
  const [traceRef, setTraceRef] = React.useState<string>('');
  const [traceHops, setTraceHops] = React.useState<MapCableTraceHop[]>([]);

  React.useEffect(() => {
    const load = async () => {
      if (!Number.isFinite(siteId) || siteId <= 0) {
        setPageError('Invalid site');
        setLoadingSite(false);
        return;
      }
      try {
        setLoadingSite(true);
        setPageError(null);
        const resp = await apiClient.getSite(siteId);
        if (!resp.success || !resp.data?.site) throw new Error(resp.error || 'Failed to load site');
        setSiteName(resp.data.site.name ?? null);
      } catch (e) {
        setPageError(e instanceof Error ? e.message : 'Failed to load site');
      } finally {
        setLoadingSite(false);
      }
    };

    void load();
  }, [siteId]);

  React.useEffect(() => {
    if (!Number.isFinite(siteId) || siteId <= 0) return;

    const timeout = setTimeout(() => {
      const run = async () => {
        try {
          setLoadingRackOptions(true);
          const resp = await apiClient.getSiteRacks(siteId, rackQuery.trim() || undefined);
          if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load racks');
          setRackOptions(resp.data.racks ?? []);
        } catch (e) {
          setRackOptions([]);
          setRackError(e instanceof Error ? e.message : 'Failed to load rack options');
        } finally {
          setLoadingRackOptions(false);
        }
      };
      void run();
    }, 250);

    return () => clearTimeout(timeout);
  }, [siteId, rackQuery]);

  const toggleRackSelection = (rackId: number) => {
    setSelectedRackIds((prev) => (prev.includes(rackId) ? prev.filter((id) => id !== rackId) : [...prev, rackId]));
  };

  const loadElevation = async () => {
    if (!selectedRackIds.length) {
      setRackElevations([]);
      return;
    }

    try {
      setRackError(null);
      setLoadingRacks(true);
      const resp = await apiClient.getSiteRackElevation(siteId, selectedRackIds);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load rack elevation');
      setRackElevations(resp.data.racks ?? []);
    } catch (e) {
      setRackError(e instanceof Error ? e.message : 'Failed to load rack elevation');
    } finally {
      setLoadingRacks(false);
    }
  };

  const clearRackSelection = () => {
    setSelectedRackIds([]);
    setRackElevations([]);
  };

  const runTrace = async () => {
    const ref = cableRefInput.trim();
    if (!ref) {
      setTraceError('Enter a cable reference to trace');
      return;
    }

    try {
      setLoadingTrace(true);
      setTraceError(null);
      const resp = await apiClient.getSiteCableTrace(siteId, ref);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to trace cable');
      setTraceRef(resp.data.cableRef);
      setTraceHops(resp.data.hops ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to trace cable';
      setTraceError(message.includes('not found') ? 'Cable ref not found' : message);
      setTraceRef('');
      setTraceHops([]);
    } finally {
      setLoadingTrace(false);
    }
  };

  if (loadingSite) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="pt-4 space-y-4">
        <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Site Hub
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{pageError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-6 mx-auto w-full max-w-7xl xl:max-w-[98rem]">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Site Hub
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{siteName ?? 'Site'}</h1>
            <p className="text-muted-foreground">MAPIndex</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'rack' | 'trace')}>
        <TabsList>
          <TabsTrigger value="rack">Rack View</TabsTrigger>
          <TabsTrigger value="trace">Cable Trace</TabsTrigger>
        </TabsList>

        <TabsContent value="rack" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rack View</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  value={rackQuery}
                  onChange={(e) => setRackQuery(e.target.value)}
                  placeholder="Select rack location(s)…"
                />
                <Button onClick={loadElevation} disabled={loadingRacks || selectedRackIds.length === 0}>
                  {loadingRacks ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
                </Button>
                <Button variant="outline" onClick={clearRackSelection} disabled={loadingRacks && !selectedRackIds.length}>
                  Clear
                </Button>
              </div>

              <div className="rounded-md border max-h-48 overflow-auto divide-y">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 p-2 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0 z-10">
                  <span>Locations</span>
                  <span>Rack Size</span>
                  <span className="sr-only">Select</span>
                </div>
                {loadingRackOptions ? (
                  <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading rack locations...
                  </div>
                ) : rackOptions.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No rack locations found.</div>
                ) : (
                  rackOptions.map((rack) => (
                    <label key={rack.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-2 text-sm cursor-pointer hover:bg-muted/40">
                      <span className="truncate">{rack.rackLocation}</span>
                      <span className="text-xs text-muted-foreground justify-self-end">{rack.rackSizeU}U</span>
                      <input
                        type="checkbox"
                        className="justify-self-end"
                        checked={selectedRackIds.includes(rack.id)}
                        onChange={() => toggleRackSelection(rack.id)}
                      />
                    </label>
                  ))
                )}
              </div>

              {rackError && (
                <Alert variant="destructive">
                  <AlertDescription>{rackError}</AlertDescription>
                </Alert>
              )}

              <RackElevationGrid siteId={siteId} racks={rackElevations} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trace" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cable Trace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={cableRefInput}
                  onChange={(e) => setCableRefInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runTrace();
                    }
                  }}
                  placeholder="e.g. #0001"
                />
                <Button onClick={() => void runTrace()} disabled={loadingTrace}>
                  {loadingTrace ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Trace'}
                </Button>
              </div>

              {traceError && (
                <Alert variant="destructive">
                  <AlertDescription>{traceError}</AlertDescription>
                </Alert>
              )}

              {!traceError && traceRef && <CableTraceView siteId={siteId} cableRef={traceRef} hops={traceHops} />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SiteMapIndexPage;
