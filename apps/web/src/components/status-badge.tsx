import { Badge } from '@/components/ui/badge';

const DELIVERY_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> =
  {
    succeeded: 'success',
    pending: 'secondary',
    in_progress: 'secondary',
    retrying: 'warning',
    dead: 'destructive',
    cancelled: 'secondary',
  };

export function DeliveryStatusBadge({ status }: { status: string }) {
  return <Badge variant={DELIVERY_STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

export function EndpointStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'active' ? 'success' : 'warning'}>{status}</Badge>;
}

const BREAKER_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  closed: 'success',
  half_open: 'warning',
  open: 'destructive',
};

export function BreakerBadge({ state }: { state: string }) {
  return <Badge variant={BREAKER_VARIANT[state] ?? 'secondary'}>{state.replace('_', ' ')}</Badge>;
}
