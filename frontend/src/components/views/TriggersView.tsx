import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/views/EmptyState';

export function TriggersView() {
  return (
    <EmptyState icon={Zap} title="No triggers yet">
      A trigger links a short sound you can make, like a click or a hum, to a phrase that gets spoken or
      typed for you.
    </EmptyState>
  );
}
