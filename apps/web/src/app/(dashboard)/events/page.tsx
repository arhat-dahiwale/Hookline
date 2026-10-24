'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { createEventSchema } from '@hookline/shared';

import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/format';
import { trpc } from '@/lib/trpc';

const PAGE_SIZE = 25;

type SendForm = z.infer<typeof createEventSchema>;

/**
 * Events list with type filter and cursor pagination (TanStack Query holds
 * pages; cursor comes from the server contract).
 */
export default function EventsPage() {
  const [type, setType] = useState<string>('');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const list = trpc.events.list.useQuery({
    type: type === '' ? undefined : type,
    limit: PAGE_SIZE,
    cursor: cursor ?? undefined,
  });

  const [sendOpen, setSendOpen] = useState(false);
  const form = useForm<SendForm>({
    resolver: zodResolver(createEventSchema),
    defaultValues: { type: '', payload: {} },
  });
  const [payloadText, setPayloadText] = useState('{}');

  const send = trpc.events.send.useMutation({
    onSuccess: () => {
      setSendOpen(false);
      void list.refetch();
    },
  });

  const onSend = (values: SendForm): void => {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText) as unknown;
    } catch {
      form.setError('payload', { message: 'Payload must be valid JSON' });
      return;
    }
    send.mutate({ ...values, payload: payload as Record<string, unknown> });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">
            Everything ingested for this organization.
          </p>
        </div>
        <Dialog open={sendOpen} onOpenChange={setSendOpen}>
          <DialogTrigger asChild>
            <Button data-testid="send-event">Send event</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send event</DialogTitle>
              <DialogDescription>
                Same ingestion path as the REST API — fan-out happens immediately.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => void form.handleSubmit(onSend)(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-type">Type</Label>
                <Input id="event-type" placeholder="order.created" {...form.register('type')} />
                {form.formState.errors.type ? (
                  <p role="alert" className="text-sm text-destructive">
                    {form.formState.errors.type.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-payload">Payload (JSON)</Label>
                <Textarea
                  id="event-payload"
                  rows={6}
                  className="font-mono"
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                />
              </div>
              {send.error ? (
                <p role="alert" className="text-sm text-destructive" data-testid="send-event-error">
                  {send.error.message}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSendOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={send.isPending} data-testid="send-event-submit">
                  Send
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by type (e.g. order.)"
          className="w-64"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setCursorStack([null]);
          }}
          aria-label="Filter events by type"
        />
      </div>

      {list.isPending ? (
        <LoadingBlock label="Loading events" />
      ) : list.isError ? (
        <ErrorBlock
          title="Could not load events"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.data.length === 0 ? (
        <EmptyBlock
          title="No events found"
          description="Events ingested through POST /v1/events or the dashboard appear here."
          testId="events-empty"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody data-testid="events-table">
              <AnimatePresence initial={false}>
                {list.data.data.map((event) => (
                  <motion.tr
                    key={event.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/events/${event.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {event.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{event.type}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={cursorStack.length <= 1 || list.isPending}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!list.data?.nextCursor || list.isPending}
          data-testid="events-next"
          onClick={() => {
            const next = list.data?.nextCursor;
            if (next) setCursorStack((stack) => [...stack, next]);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
