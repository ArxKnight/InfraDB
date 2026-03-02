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
  const line1 = `${hop.hostname} (${hop.sidId ? `SID: ${hop.sidId}` : 'Unknown SID'})`;
  const line2 = `${hop.manufacturer || 'Unknown'} - ${hop.modelName || 'Unknown'}${hop.rackUnits ? ` | (${hop.rackUnits}U)` : ''}`;
  const line3 = `${hop.rackLocation || 'Unknown location'}${hop.rackU ? ` - U${hop.rackU}` : ''}`;
  const connected = [hop.portLabel || null, hop.nicType || null].filter(Boolean).join(' ');
  const line4 = `Connected Port: ${connected || 'Unknown'}`;
  return [line1, line2, line3, line4].join('\n');
}

const CableTraceView: React.FC<CableTraceViewProps> = ({ siteId, cableRef, hops }) => {
  const navigate = useNavigate();

  const textVersion = React.useMemo(() => {
    const lines: string[] = [`Cable Trace Ref ${cableRef}`];
    for (let i = 0; i < hops.length; i += 1) {
      lines.push('');
      lines.push(hopText(hops[i]!));
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cable Trace Ref {cableRef}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-4 w-4 mr-2" />
          Copy trace
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {hops.map((hop, idx) => {
          const connected = [hop.portLabel || null, hop.nicType || null].filter(Boolean).join(' ');
          const clickable = Number.isFinite(Number(hop.sidId)) && Number(hop.sidId) > 0;

          return (
            <div key={`${hop.sidId ?? 'unknown'}-${idx}`} className="relative">
              <div
                className={`rounded-md border p-3 ${clickable ? 'cursor-pointer hover:border-primary/40 hover:bg-muted/40' : ''}`}
                onClick={
                  clickable
                    ? () => navigate(`/sites/${siteId}/sid/${Number(hop.sidId)}`)
                    : undefined
                }
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/sites/${siteId}/sid/${Number(hop.sidId)}`);
                        }
                      }
                    : undefined
                }
              >
                <div className="font-medium text-sm">{hop.hostname} ({hop.sidId ? `SID: ${hop.sidId}` : 'Unknown SID'})</div>
                <div className="text-sm text-muted-foreground">
                  {hop.manufacturer || 'Unknown'} - {hop.modelName || 'Unknown'}{hop.rackUnits ? ` | (${hop.rackUnits}U)` : ''}
                </div>
                <div className="text-sm">{hop.rackLocation || 'Unknown location'}{hop.rackU ? ` - U${hop.rackU}` : ''}</div>
                <div className="text-sm text-muted-foreground">Connected Port: {connected || 'Unknown endpoint'}</div>
              </div>

              {idx < hops.length - 1 && (
                <div className="flex justify-center py-1">
                  <div className="h-5 border-l border-muted-foreground/40" />
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
