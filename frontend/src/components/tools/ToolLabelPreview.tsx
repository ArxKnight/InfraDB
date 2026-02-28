import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { splitLines } from './utils';

export function MatrixPlaceholder({ size = 44, className }: { size?: number; className?: string }) {
  const style = useMemo<React.CSSProperties>(
    () => ({
      width: size,
      height: size,
      backgroundColor: 'white',
      backgroundImage:
        'linear-gradient(rgba(0,0,0,0.35) 1px, transparent 1px),\n         linear-gradient(90deg, rgba(0,0,0,0.35) 1px, transparent 1px),\n         linear-gradient(rgba(0,0,0,0.10) 1px, transparent 1px),\n         linear-gradient(90deg, rgba(0,0,0,0.10) 1px, transparent 1px)',
      backgroundSize: '6px 6px, 6px 6px, 18px 18px, 18px 18px',
      backgroundPosition: '0 0, 0 0, 0 0, 0 0',
    }),
    [size]
  );

  return <div className={cn('rounded-sm border border-foreground/30', className)} style={style} />;
}

export function LabelFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border bg-background text-foreground shadow-sm',
        'px-3 py-2',
        className
      )}
    >
      {children}
    </div>
  );
}

export function SidPreview({ sid }: { sid: string }) {
  const sids = splitLines(sid);
  if (!sids.length) return null;

  return (
    <div className="space-y-2">
      {sids.slice(0, 12).map((value, idx) => (
        <LabelFrame key={`${idx}-${value}`} className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold tracking-wide truncate">{value}</div>
          <MatrixPlaceholder size={46} />
        </LabelFrame>
      ))}
    </div>
  );
}

export function DayWipePreview({ sid, dateStr }: { sid: string; dateStr: string }) {
  const sids = splitLines(sid);
  if (!sids.length) return null;

  return (
    <div className="space-y-2">
      {sids.slice(0, 12).map((value, idx) => {
        const line = `${value} Wipe ${dateStr}`;

        return (
          <LabelFrame key={`${idx}-${value}`}>
            <div className="flex flex-col gap-1 text-center">
              <div className="text-sm font-semibold">{line}</div>
              <div className="text-sm font-semibold">{line}</div>
            </div>
          </LabelFrame>
        );
      })}
    </div>
  );
}

export function TextPreview({ lines }: { lines: string[] }) {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return null;

  return (
    <div className="space-y-2">
      {cleaned.slice(0, 12).map((line, idx) => (
        <LabelFrame key={`${idx}-${line}`} className="text-center">
          <div className="text-sm font-medium break-words">{line}</div>
        </LabelFrame>
      ))}
    </div>
  );
}

function rackShortName(full: string): string {
  const parts = full.split('ROW');
  const after = parts[1] ?? full;
  return after.replace(/\//g, '').replace('R', '');
}

export function RackPreview({ rack }: { rack: string }) {
  const racks = splitLines(rack);
  if (!racks.length) return null;

  return (
    <div className="max-h-[420px] overflow-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {racks.slice(0, 12).map((value, idx) => {
          const short = rackShortName(value);

          return (
            <LabelFrame key={`${idx}-${value}`} className="h-52 w-36 flex flex-col justify-between">
              <div className="pt-2 text-center">
                <div className="text-3xl font-bold tracking-wide">{short}</div>
              </div>
              <div className="pb-2 flex justify-center">
                <MatrixPlaceholder size={62} />
              </div>
            </LabelFrame>
          );
        })}
      </div>
    </div>
  );
}

export function InRackPreview({ fromSid, toSid }: { fromSid: string; toSid: string }) {
  const a = fromSid.trim();
  const b = toSid.trim();
  if (!a || !b) return null;

  return (
    <LabelFrame className="aspect-square w-44 flex flex-col items-center justify-center gap-2">
      <div className="text-lg font-semibold">{a} -</div>
      <div className="text-lg font-semibold">{b}</div>
    </LabelFrame>
  );
}

export function PortsPreview(opts: {
  hostname: string;
  bankPrefix: string;
  prefix: string;
  fromPort: number;
  toPort: number;
}) {
  const hostname = opts.hostname.trim();
  if (!hostname) return null;

  const from = Math.max(1, Math.floor(Number(opts.fromPort) || 1));
  const to = Math.max(from, Math.floor(Number(opts.toPort) || from));
  const maxTo = Math.min(to, from + 47);

  const ports: number[] = [];
  for (let p = from; p <= maxTo; p++) ports.push(p);

  const bankPrefix = opts.bankPrefix.trim() ? `${opts.bankPrefix.trim()} ` : '';
  const prefix = opts.prefix.toUpperCase();

  return (
    <div className="max-h-[420px] overflow-auto">
      <div className="grid grid-cols-3 gap-2">
        {ports.map((p) => {
          const portStr = String(p).padStart(2, '0');
          const line2 = `${bankPrefix}${prefix} ${portStr}`.trim();

          return (
            <LabelFrame key={p} className="p-1 w-fit justify-self-center">
              <div className="h-[4.5rem] w-[4.5rem] flex flex-col items-center justify-center gap-1">
                <div className="text-[11px] font-semibold leading-none text-center w-full truncate">{hostname}</div>
                <div className="text-[11px] font-semibold leading-none text-center w-full truncate">{line2}</div>
              </div>
            </LabelFrame>
          );
        })}
      </div>
    </div>
  );
}

export function PduPreview(opts: { pduSid: string; fromPort: number; toPort: number }) {
  const sid = opts.pduSid.trim();
  if (!sid) return null;

  const from = Math.max(1, Math.floor(Number(opts.fromPort) || 1));
  const to = Math.max(from, Math.floor(Number(opts.toPort) || from));
  const maxTo = Math.min(to, from + 47);

  const ports: number[] = [];
  for (let p = from; p <= maxTo; p++) ports.push(p);

  return (
    <div className="max-h-[420px] overflow-auto">
      <div className="grid grid-cols-3 gap-2">
        {ports.map((p) => {
          const portStr = String(p).padStart(2, '0');
          const line = `${sid} ${portStr}`;

          return (
            <LabelFrame key={p} className="p-1 w-fit justify-self-center">
              <div className="h-[4.5rem] w-[4.5rem] flex items-center justify-center">
                <div className="text-[12px] font-semibold leading-tight text-center w-full truncate">{line}</div>
              </div>
            </LabelFrame>
          );
        })}
      </div>
    </div>
  );
}
