import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { MapCableTraceHop } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

type CableTraceViewProps = {
  siteId: number;
  cableRef: string;
  hops: MapCableTraceHop[];
};

function hopText(hop: MapCableTraceHop): string {
  const displayHostname = String(hop.hostname ?? '').trim() || 'Unknown';
  const displaySid = hop.sidId ? String(hop.sidId) : 'Unknown';
  const displayRackU = String(hop.rackUText ?? '').trim() || 'Unknown';
  const line1 = `${displayHostname} (SID: ${displaySid})`;
  const line2 = `${hop.manufacturer || 'Unknown'} - ${hop.modelName || 'Unknown'} | (${displayRackU})`;
  const line3 = `${hop.rackLocation || 'Unknown location'}`;
  const connected = [hop.portLabel || null, hop.nicType || null].filter(Boolean).join(' ');
  const line4 = `Connected Port: ${connected || 'Unknown'}`;
  return [line1, line2, line3, line4].join('\n');
}

const CableTraceView: React.FC<CableTraceViewProps> = ({ siteId, cableRef, hops }) => {
  const navigate = useNavigate();

  const sidHopIds = React.useMemo(
    () => hops
      .map((hop) => (Number.isFinite(Number(hop.sidId)) && Number(hop.sidId) > 0 ? Number(hop.sidId) : null))
      .filter((sidId): sidId is number => Number.isFinite(Number(sidId)) && Number(sidId) > 0),
    [hops],
  );

  const sourceSidId = sidHopIds.length > 0 ? sidHopIds[0] : null;
  const destinationSidId = sidHopIds.length > 1 ? sidHopIds[sidHopIds.length - 1] : null;
  const sourcePatchPanelSidId = sidHopIds.length >= 3 ? sidHopIds[1] : null;
  const destinationPatchPanelSidId = sidHopIds.length >= 4 ? sidHopIds[sidHopIds.length - 2] : null;

  const navigationActions = React.useMemo(() => {
    const actions: Array<{ key: string; label: string; to: string }> = [
      { key: 'open-cable-ref', label: 'Open Cable Ref#', to: `/sites/${siteId}/cable?reference=${encodeURIComponent(cableRef)}` },
    ];

    if (sourceSidId) {
      actions.push({ key: 'open-source-sid', label: 'Open Source SID', to: `/sites/${siteId}/sid/${sourceSidId}` });
    }
    if (sourcePatchPanelSidId) {
      actions.push({ key: 'open-source-pp-sid', label: 'Open Source Patch Panel SID', to: `/sites/${siteId}/sid/${sourcePatchPanelSidId}` });
    }
    if (destinationPatchPanelSidId) {
      actions.push({ key: 'open-destination-pp-sid', label: 'Open Destination Patch Panel SID', to: `/sites/${siteId}/sid/${destinationPatchPanelSidId}` });
    }
    if (destinationSidId) {
      actions.push({ key: 'open-destination-sid', label: 'Open Destination SID', to: `/sites/${siteId}/sid/${destinationSidId}` });
    }

    return actions;
  }, [cableRef, destinationPatchPanelSidId, destinationSidId, siteId, sourcePatchPanelSidId, sourceSidId]);

  const textVersion = React.useMemo(() => {
    const lines: string[] = [`Cable Trace Ref ${cableRef}`];
    for (let i = 0; i < hops.length; i += 1) {
      lines.push('');
      if (i === 0) {
        lines.push('Source');
      }
      lines.push(hopText(hops[i]!));
      if (i === hops.length - 1) {
        lines.push('Destination');
      }
      if (i < hops.length - 1) lines.push('|');
    }
    return lines.join('\n');
  }, [cableRef, hops]);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(textVersion);
    if (ok) toast.success('Trace copied');
    else toast.error('Failed to copy trace');
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">Cable Trace Ref {cableRef}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copy trace
          </Button>
          {navigationActions.map((action) => (
            <Button key={action.key} type="button" variant="outline" size="sm" onClick={() => navigate(action.to)}>
              {action.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hops.map((hop, idx) => {
          const connected = [hop.portLabel || null, hop.nicType || null].filter(Boolean).join(' ');
          const displayHostname = String(hop.hostname ?? '').trim() || 'Unknown';
          const displaySid = hop.sidId ? String(hop.sidId) : 'Unknown';
          const displayRackU = String(hop.rackUText ?? '').trim() || 'Unknown';
          const isFirst = idx === 0;
          const isLast = idx === hops.length - 1;

          return (
            <div key={`${hop.sidId ?? 'unknown'}-${idx}`} className="relative">
              {isFirst && (
                <div className="mb-2 flex justify-center">
                  <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                    Source
                  </span>
                </div>
              )}

              <div className="rounded-md border p-3 text-center">
                <div className="font-medium text-sm">{displayHostname} (SID: {displaySid})</div>
                <div className="text-sm text-muted-foreground">
                  {hop.manufacturer || 'Unknown'} - {hop.modelName || 'Unknown'} | ({displayRackU})
                </div>
                <div className="text-sm">{hop.rackLocation || 'Unknown location'}</div>
                <div className="text-sm text-muted-foreground">Connected Port: {connected || 'Unknown'}</div>
              </div>

              {isLast && (
                <div className="mt-2 flex justify-center">
                  <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                    Destination
                  </span>
                </div>
              )}

              {idx < hops.length - 1 && (
                <div className="flex justify-center py-2">
                  <div className="h-10 border-l-2 border-muted-foreground/50" />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default CableTraceView;
