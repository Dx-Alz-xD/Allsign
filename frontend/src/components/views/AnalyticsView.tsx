import { ChartNoAxesColumn } from 'lucide-react';
import { EmptyState } from '@/components/views/EmptyState';

export function AnalyticsView() {
  return (
    <EmptyState icon={ChartNoAxesColumn} title="No sessions yet">
      Speaking rate, blocks, and fluency trends appear here after your first recorded session.
    </EmptyState>
  );
}
