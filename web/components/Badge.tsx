import { statusLabels } from '../lib/format.ts';

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      <i />
      {statusLabels[value] || value}
    </span>
  );
}
