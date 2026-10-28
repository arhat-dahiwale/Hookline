'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createEndpointSchema } from '@hookline/shared';

import { SecretDialog } from '@/components/secret-dialog';
import { EndpointStatusBadge } from '@/components/status-badge';
import { EmptyBlock, ErrorBlock, LoadingBlock, isOrgRequiredError } from '@/components/view-states';
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
import { trpc } from '@/lib/trpc';

type CreateForm = z.infer<typeof createEndpointSchema>;

/**
 * Endpoints list (API.md endpoints.*). Create is admin-only — the mutation
 * surfaces the server's FORBIDDEN for members.
 */
export default function EndpointsPage() {
  const list = trpc.endpoints.list.useQuery();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const form = useForm<CreateForm>({
    resolver: zodResolver(createEndpointSchema),
    defaultValues: { url: '', description: '', eventTypes: [] },
  });

  const create = trpc.endpoints.create.useMutation({
    onSuccess: (result) => {
      setOpen(false);
      form.reset();
      setCreatedSecret(result.secret);
      void utils.endpoints.list.invalidate();
    },
  });

  const onSubmit = (values: CreateForm): void => {
    create.mutate(values);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Endpoints</h1>
          <p className="text-sm text-muted-foreground">Where Hookline delivers your webhooks.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="create-endpoint">New endpoint</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create endpoint</DialogTitle>
              <DialogDescription>
                HTTPS URLs only. The signing secret is shown once after creation.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  placeholder="https://api.example.com/hooks"
                  {...form.register('url')}
                />
                {form.formState.errors.url ? (
                  <p role="alert" className="text-sm text-destructive">
                    {form.formState.errors.url.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="What is this endpoint for?"
                  {...form.register('description')}
                />
              </div>
              {create.error ? (
                <p
                  role="alert"
                  className="text-sm text-destructive"
                  data-testid="create-endpoint-error"
                >
                  {create.error.message}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending}
                  data-testid="create-endpoint-submit"
                >
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {list.isPending ? (
        <LoadingBlock label="Loading endpoints" />
      ) : list.isError ? (
        isOrgRequiredError(list.error) ? (
          <EmptyBlock
            title="Create an organization to get started"
            description="Endpoints live inside an organization. Create or switch to one from the org switcher."
            testId="org-required"
          />
        ) : (
          <ErrorBlock
            title="Could not load endpoints"
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        )
      ) : list.data.data.length === 0 ? (
        <EmptyBlock
          title="No endpoints yet"
          description="Create your first endpoint to start receiving signed webhooks."
          testId="endpoints-empty"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">URL</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Filters</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody data-testid="endpoints-table">
              <AnimatePresence initial={false}>
                {list.data.data.map((endpoint) => (
                  <motion.tr
                    key={endpoint.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="max-w-[320px] px-4 py-3">
                      <Link
                        href={`/endpoints/${endpoint.id}`}
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {endpoint.url}
                      </Link>
                      {endpoint.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {endpoint.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <EndpointStatusBadge status={endpoint.status} />
                    </td>
                    <td className="hidden max-w-[220px] truncate px-4 py-3 text-muted-foreground md:table-cell">
                      {endpoint.eventTypes.length > 0
                        ? endpoint.eventTypes.join(', ')
                        : 'all events'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(endpoint.createdAt).toLocaleDateString()}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {createdSecret ? (
        <SecretDialog
          title="Endpoint secret"
          description="Copy it now — this is the only time it is shown. Use it to verify the Hookline-Signature header."
          secret={createdSecret}
          testId="endpoint-secret"
          onClose={() => setCreatedSecret(null)}
        />
      ) : null}
    </div>
  );
}
