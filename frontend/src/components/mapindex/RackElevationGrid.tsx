import React from 'react';
import type { MapRackElevation } from '../../types';
import RackCard from './RackCard';

type RackElevationGridProps = {
  siteId: number;
  racks: MapRackElevation[];
};

const RackElevationGrid: React.FC<RackElevationGridProps> = ({ siteId, racks }) => {
  if (!racks.length) {
    return <div className="text-sm text-muted-foreground">Select rack locations to view rack/s visually</div>;
  }

  return (
    <div className="flex justify-center gap-4 overflow-x-auto pb-2">
      {racks.map((rack) => (
        <RackCard key={rack.rackId} siteId={siteId} rack={rack} />
      ))}
    </div>
  );
};

export default RackElevationGrid;
