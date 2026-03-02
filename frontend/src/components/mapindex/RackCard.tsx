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

  const rows = React.useMemo(() => {
    const maxU = Number.isFinite(Number(rack.rackSizeU)) && Number(rack.rackSizeU) > 0 ? Number(rack.rackSizeU) : 42;
    return Array.from({ length: maxU }, (_, index) => maxU - index);
  }, [rack.rackSizeU]);

  const occupantByU = React.useMemo(() => {
    const map = new Map<number, { sidId: number; sidNumber: string; hostname: string }>();
    const maxU = Number.isFinite(Number(rack.rackSizeU)) && Number(rack.rackSizeU) > 0 ? Number(rack.rackSizeU) : 42;
    for (const occ of rack.occupants ?? []) {
      if (!Number.isFinite(occ.uPosition) || occ.uPosition < 1) continue;
      const startU = Math.trunc(Number(occ.uPosition));
      const units = Number.isFinite(Number(occ.rackUnits)) && Number(occ.rackUnits) > 0 ? Math.trunc(Number(occ.rackUnits)) : 1;
      const endU = Math.min(maxU, startU + units - 1);

      const occupant = {
        sidId: Number(occ.sidId),
        sidNumber: String(occ.sidNumber ?? '').trim(),
        hostname: String(occ.hostname ?? '').trim(),
      };

      for (let u = startU; u <= endU; u += 1) {
        if (!map.has(u)) {
          map.set(u, occupant);
        }
      }
    }
    return map;
  }, [rack.occupants, rack.rackSizeU]);

  return (
    <Card className="min-w-[320px] w-full md:w-[360px]">
      <CardHeader className="pb-2 text-center">
        <CardTitle className="text-sm font-semibold text-center">Rack - {rack.rackLocation}</CardTitle>
        <div className="text-xs text-muted-foreground text-center">{rack.rackSizeU}U</div>
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
                    <td className="w-12 px-2 py-1 text-muted-foreground text-center">U{u}</td>
                    <td className="px-2 py-1 text-center">
                      {occupant ? (
                        <button
                          type="button"
                          className="inline-flex justify-center w-full text-center underline-offset-2 hover:underline hover:text-primary"
                          onClick={() => navigate(`/sites/${siteId}/sid/${occupant.sidId}`)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-center">—</span>
                      )}
                    </td>
                    <td className="w-12 px-2 py-1 text-muted-foreground text-center">U{u}</td>
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
