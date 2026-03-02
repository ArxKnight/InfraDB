import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { MapRackElevation } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

type RackCardProps = {
  siteId: number;
  rack: MapRackElevation;
};

const RackCard: React.FC<RackCardProps> = ({ siteId, rack }) => {
  const navigate = useNavigate();

  const occupantByU = React.useMemo(() => {
    const map = new Map<number, { sidId: number; sidNumber: string; hostname: string }>();
    for (const occ of rack.occupants ?? []) {
      if (!Number.isFinite(occ.uPosition) || occ.uPosition < 1) continue;
      map.set(occ.uPosition, {
        sidId: Number(occ.sidId),
        sidNumber: String(occ.sidNumber ?? '').trim(),
        hostname: String(occ.hostname ?? '').trim(),
      });
    }
    return map;
  }, [rack.occupants]);

  const rows = React.useMemo(() => {
    const maxU = Number.isFinite(Number(rack.rackSizeU)) && Number(rack.rackSizeU) > 0 ? Number(rack.rackSizeU) : 42;
    return Array.from({ length: maxU }, (_, index) => maxU - index);
  }, [rack.rackSizeU]);

  return (
    <Card className="min-w-[320px] w-full md:w-[360px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Rack - {rack.rackLocation}</CardTitle>
        <div className="text-xs text-muted-foreground">{rack.rackSizeU}U</div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[65vh] border rounded-md">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((u) => {
                const occupant = occupantByU.get(u);
                const label = occupant
                  ? `${occupant.hostname || `SID-${occupant.sidId}`} (SID: ${occupant.sidNumber || occupant.sidId})`
                  : '';

                return (
                  <tr key={`${rack.rackId}-${u}`} className="border-b last:border-b-0">
                    <td className="w-12 px-2 py-1 text-muted-foreground text-right">U{u}</td>
                    <td className="px-2 py-1">
                      {occupant ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline hover:text-primary"
                          onClick={() => navigate(`/sites/${siteId}/sid/${occupant.sidId}`)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="w-12 px-2 py-1 text-muted-foreground">U{u}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default RackCard;
