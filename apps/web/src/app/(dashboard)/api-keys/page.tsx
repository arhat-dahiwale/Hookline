'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { z } from 'zod';

import { createApiKeySchema, API_KEY_SCOPES, type ApiKeyScope } from '@hookline/shared';

import { SecretDialog } from '@/components/secret-dialog';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Badge } from '@/components/ui/badge';
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
import { formatDateTime, formatRelative } from '@/lib/format';
import { trpc } from '@/lib/trpc';

type CreateForm = z.infer<typeof createApiKeySchema>;

/**
 * API keys page (admin-only server-side; members see the FORBIDDEN error).
 * The full key is displayed exactly once after creation.
 */
export default function ApiKeysPage() {
  const list = trpc.apiKeys.list.useQuery();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const form = useForm<CreateForm>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: '', scopes: ['events:write'] },
  });
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(['events:write']);

  const create = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      setCreateOpen(false);
      setCreatedSecret(result.secret);
      form.reset();
      void utils.apiKeys.list.invalidate();
    },
  });
  const revoke = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => void utils.apiKeys.list.invalidate(),
  });

  const toggleScope = (scope: ApiKeyScope): void => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  };

  const onCreate = (values: CreateForm): void => {
    create.mutate({ ...values, scopes: selectedScopes });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Machine credentials for the public REST API (role: admin).
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="create-api-key">New API key</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Grant only the scopes the integration needs. The full key is shown once.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => void form.handleSubmit(onCreate)(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" placeholder="billing-service" {...form.register('name')} />
                {form.formState.errors.name ? (
                  <p role="alert" className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="grid grid-cols-2 gap-2" data-testid="scope-picker">
                  {API_KEY_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        aria-label={scope}
                      />
                      <code className="text-xs">{scope}</code>
                    </label>
                  ))}
                </div>
                {selectedScopes.length === 0 ? (
                  <p role="alert" className="text-sm text-destructive">
                    At least one scope is required.
                  </p>
                ) : null}
              </div>
              {create.error ? (
                <p
                  role="alert"
                  className="text-sm text-destructive"
                  data-testid="create-api-key-error"
                >
                  {create.error.message}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending || selectedScopes.length === 0}
                  data-testid="create-api-key-submit"
                >
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {list.isPending ? (
        <LoadingBlock label="Loading API keys" />
      ) : list.isError ? (
        <ErrorBlock
          title="Could not load API keys"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.data.length === 0 ? (
        <EmptyBlock
          title="No API keys"
          description="Create a key so integrations can call the REST API."
          testId="api-keys-empty"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Prefix</th>
                <th className="px-4 py-3 font-medium">Scopes</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Last used</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody data-testid="api-keys-table">
              <AnimatePresence initial={false}>
                {list.data.data.map((key) => (
                  <motion.tr
                    key={key.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t"
                  >
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{key.prefix}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'never'}
                    </td>
                    <td className="px-4 py-3">
                      {key.revokedAt ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!key.revokedAt ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revoke.isPending}
                          data-testid={`revoke-key-${key.id}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke "${key.name}"? Clients using it will get 401s.`,
                              )
                            ) {
                              revoke.mutate({ id: key.id });
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          revoked {formatDateTime(key.revokedAt)}
                        </span>
                      )}
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
          title="Your new API key"
          description="Copy it now — it is never shown again and cannot be recovered."
          secret={createdSecret}
          testId="api-key-secret"
          onClose={() => setCreatedSecret(null)}
        />
      ) : null}
    </div>
  );
}
