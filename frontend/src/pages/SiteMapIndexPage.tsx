import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';
import type { MapCableTraceHop, MapRackElevation, MapRackOption } from '../types';
import { downloadBlobAsNamedFile, makeTimestampLocal } from '../lib/download';
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
  const [siteCode, setSiteCode] = React.useState<string | null>(null);
  const [loadingSite, setLoadingSite] = React.useState(true);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const [activeTab, setActiveTab] = React.useState<'rack' | 'trace' | 'reports'>('rack');

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
  const [reportsError, setReportsError] = React.useState<string | null>(null);

  const [isGeneratingOverviewReport, setIsGeneratingOverviewReport] = React.useState(false);

  const [isGeneratingSidReport, setIsGeneratingSidReport] = React.useState(false);

  const [cableTraceReportInput, setCableTraceReportInput] = React.useState('');
  const [isGeneratingCableTraceReport, setIsGeneratingCableTraceReport] = React.useState(false);

  const [reportRackQuery, setReportRackQuery] = React.useState('');
  const [reportRackOptions, setReportRackOptions] = React.useState<MapRackOption[]>([]);
  const [reportSelectedRackIds, setReportSelectedRackIds] = React.useState<number[]>([]);
  const [loadingReportRackOptions, setLoadingReportRackOptions] = React.useState(false);
  const [loadingReportRacks, setLoadingReportRacks] = React.useState(false);
  const [reportRackError, setReportRackError] = React.useState<string | null>(null);
  const [reportRackElevations, setReportRackElevations] = React.useState<MapRackElevation[]>([]);
  const [isGeneratingVisualRackReport, setIsGeneratingVisualRackReport] = React.useState(false);

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
        setSiteCode(String(resp.data.site.code ?? '').toUpperCase() || null);
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

  React.useEffect(() => {
    if (!Number.isFinite(siteId) || siteId <= 0) return;

    const timeout = setTimeout(() => {
      const run = async () => {
        try {
          setLoadingReportRackOptions(true);
          const resp = await apiClient.getSiteRacks(siteId, reportRackQuery.trim() || undefined);
          if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load racks');
          setReportRackOptions(resp.data.racks ?? []);
        } catch (e) {
          setReportRackOptions([]);
          setReportRackError(e instanceof Error ? e.message : 'Failed to load rack options');
        } finally {
          setLoadingReportRackOptions(false);
        }
      };
      void run();
    }, 250);

    return () => clearTimeout(timeout);
  }, [siteId, reportRackQuery]);

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

  const toggleReportRackSelection = (rackId: number) => {
    setReportSelectedRackIds((prev) =>
      prev.includes(rackId) ? prev.filter((id) => id !== rackId) : [...prev, rackId],
    );
  };

  const loadReportRackElevation = async () => {
    if (!reportSelectedRackIds.length) {
      setReportRackElevations([]);
      return;
    }

    try {
      setReportRackError(null);
      setLoadingReportRacks(true);
      const resp = await apiClient.getSiteRackElevation(siteId, reportSelectedRackIds);
      if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to load rack elevation');
      setReportRackElevations(resp.data.racks ?? []);
    } catch (e) {
      setReportRackError(e instanceof Error ? e.message : 'Failed to load rack elevation');
    } finally {
      setLoadingReportRacks(false);
    }
  };

  const clearReportRackSelection = () => {
    setReportSelectedRackIds([]);
    setReportRackElevations([]);
  };

  const handleDownloadSiteOverviewReport = async () => {
    try {
      setReportsError(null);
      setIsGeneratingOverviewReport(true);
      const { blob, filename } = await apiClient.downloadSiteCableReport(siteId);
      const fallbackFilename = `${String(siteCode || 'SITE')}_site_overview_report_${makeTimestampLocal()}.docx`;
      downloadBlobAsNamedFile(blob, filename || fallbackFilename);
    } catch {
      setReportsError('Failed to generate report. Please try again.');
    } finally {
      setIsGeneratingOverviewReport(false);
    }
  };

  const handleDownloadSidIndexReport = async () => {
    try {
      setReportsError(null);
      setIsGeneratingSidReport(true);
      const { blob, filename } = await apiClient.downloadSiteSidIndexReport(siteId);
      const fallbackFilename = `${String(siteCode || 'SITE')}_sid_index_report_${makeTimestampLocal()}.docx`;
      downloadBlobAsNamedFile(blob, filename || fallbackFilename);
    } catch {
      setReportsError('Failed to generate SID Index report. Please try again.');
    } finally {
      setIsGeneratingSidReport(false);
    }
  };

  const parseCableRefs = (input: string): string[] => {
    const refs = input
      .split(/[\n,]/g)
      .map((ref) => ref.trim())
      .filter((ref) => ref !== '')
      .slice(0, 100);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const ref of refs) {
      const key = ref.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ref);
    }
    return unique;
  };

  const handleDownloadCableTraceReport = async () => {
    const refs = parseCableRefs(cableTraceReportInput);
    if (!refs.length) {
      setReportsError('Enter one or more cable references.');
      return;
    }

    try {
      setReportsError(null);
      setIsGeneratingCableTraceReport(true);
      const { blob, filename } = await apiClient.downloadSiteCableTraceReport(siteId, refs);
      const fallbackFilename = `${String(siteCode || 'SITE')}_cable_trace_report_${makeTimestampLocal()}.docx`;
      downloadBlobAsNamedFile(blob, filename || fallbackFilename);
    } catch {
      setReportsError('Failed to generate Cable Trace report. Please try again.');
    } finally {
      setIsGeneratingCableTraceReport(false);
    }
  };

  const handleDownloadVisualRackReport = async () => {
    if (!reportSelectedRackIds.length) {
      setReportsError('Select one or more rack locations.');
      return;
    }
    try {
      setReportsError(null);
      setIsGeneratingVisualRackReport(true);
      const { blob, filename } = await apiClient.downloadSiteVisualRackReport(siteId, reportSelectedRackIds);
      const fallbackFilename = `${String(siteCode || 'SITE')}_visual_rack_report_${makeTimestampLocal()}.docx`;
      downloadBlobAsNamedFile(blob, filename || fallbackFilename);
    } catch {
      setReportsError('Failed to generate Visual Rack report. Please try again.');
    } finally {
      setIsGeneratingVisualRackReport(false);
    }
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'rack' | 'trace' | 'reports')}>
        <TabsList>
          <TabsTrigger value="rack">Rack View</TabsTrigger>
          <TabsTrigger value="trace">Cable Trace</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
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

        <TabsContent value="reports" className="space-y-4">
          {reportsError && (
            <Alert variant="destructive">
              <AlertDescription>{reportsError}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Site Overview Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Export a Word document containing site locations, cable types, and all cable runs for this site.
              </p>
              <Button onClick={() => void handleDownloadSiteOverviewReport()} disabled={isGeneratingOverviewReport}>
                {isGeneratingOverviewReport ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Download Site Overview Report (.docx)'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SID Index Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={() => void handleDownloadSidIndexReport()} disabled={isGeneratingSidReport}>
                {isGeneratingSidReport ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Download SID Index Report (.docx)'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cable Trace Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  value={cableTraceReportInput}
                  onChange={(e) => setCableTraceReportInput(e.target.value)}
                  placeholder="Enter one or more refs (comma or new line): #0001, #0002"
                />
                <Button onClick={() => void handleDownloadCableTraceReport()} disabled={isGeneratingCableTraceReport}>
                  {isGeneratingCableTraceReport ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Download Trace Report (.docx)'}
                </Button>
                <div />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visual Rack Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  value={reportRackQuery}
                  onChange={(e) => setReportRackQuery(e.target.value)}
                  placeholder="Select rack location(s)…"
                />
                <Button onClick={() => void loadReportRackElevation()} disabled={loadingReportRacks || reportSelectedRackIds.length === 0}>
                  {loadingReportRacks ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
                </Button>
                <Button variant="outline" onClick={clearReportRackSelection} disabled={loadingReportRacks && !reportSelectedRackIds.length}>
                  Clear
                </Button>
              </div>

              <div className="rounded-md border max-h-48 overflow-auto divide-y">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 p-2 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0 z-10">
                  <span>Locations</span>
                  <span>Rack Size</span>
                  <span className="sr-only">Select</span>
                </div>
                {loadingReportRackOptions ? (
                  <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading rack locations...
                  </div>
                ) : reportRackOptions.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No rack locations found.</div>
                ) : (
                  reportRackOptions.map((rack) => (
                    <label
                      key={rack.id}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-2 text-sm cursor-pointer hover:bg-muted/40"
                    >
                      <span className="truncate">{rack.rackLocation}</span>
                      <span className="text-xs text-muted-foreground justify-self-end">{rack.rackSizeU}U</span>
                      <input
                        type="checkbox"
                        className="justify-self-end"
                        checked={reportSelectedRackIds.includes(rack.id)}
                        onChange={() => toggleReportRackSelection(rack.id)}
                      />
                    </label>
                  ))
                )}
              </div>

              {reportRackError && (
                <Alert variant="destructive">
                  <AlertDescription>{reportRackError}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void handleDownloadVisualRackReport()} disabled={isGeneratingVisualRackReport || reportSelectedRackIds.length === 0}>
                  {isGeneratingVisualRackReport ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Download Visual Rack Report (.docx)'}
                </Button>
              </div>

              <RackElevationGrid siteId={siteId} racks={reportRackElevations} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SiteMapIndexPage;
