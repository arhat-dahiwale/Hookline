'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/format';
import { trpc } from '@/lib/trpc';

const settingsFormSchema = z.object({
  retentionDays: z.number({ message: 'Enter a number of days' }).int().min(1).max(3650).nullable(),
});
type SettingsForm = z.infer<typeof settingsFormSchema>;

/**
 * Settings (admin-only server-side): org retention override + audit trail.
 */
export default function SettingsPage() {
  const settings = trpc.settings.get.useQuery();
  const audit = trpc.audit.list.useQuery({ limit: 20 });
  const utils = trpc.useUtils();
  const [saved, setSaved] = useState(false);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: { retentionDays: null },
  });

  useEffect(() => {
    if (settings.data) {
      form.reset({ retentionDays: settings.data.retentionDays });
    }
  }, [settings.data, form]);

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void utils.settings.get.invalidate();
      void utils.audit.list.invalidate();
    },
  });

  const onSubmit = (values: SettingsForm): void => {
    update.mutate({ retentionDays: values.retentionDays });
  };

  if (settings.isPending) return <LoadingBlock label="Loading settings" />;
  if (settings.isError) {
    return (
      <ErrorBlock
        title="Could not load settings"
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Organization preferences (role: admin). Changes are audited.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention</CardTitle>
          <CardDescription>
            Days to keep events and attempts before cleanup (Phase 11 job). Empty = system default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="max-w-xs space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="retention">Retention days</Label>
              <Input
                id="retention"
                type="number"
                min={1}
                max={3650}
                placeholder="system default"
                {...form.register('retentionDays', {
                  setValueAs: (value) => (value === '' || value === null ? null : Number(value)),
                })}
              />
              {form.formState.errors.retentionDays ? (
                <p role="alert" className="text-sm text-destructive">
                  {String(form.formState.errors.retentionDays.message)}
                </p>
              ) : null}
            </div>
            {update.error ? (
              <p role="alert" className="text-sm text-destructive" data-testid="settings-error">
                {update.error.message}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={update.isPending} data-testid="settings-save">
                Save
              </Button>
              <AnimatePresence>
                {saved ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm text-[var(--success)]"
                    data-testid="settings-saved"
                  >
                    Saved
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription>Recent administrative actions in this organization.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.isPending ? (
            <p className="text-sm text-muted-foreground">Loading audit log…</p>
          ) : audit.isError ? (
            <p className="text-sm text-destructive">{audit.error.message}</p>
          ) : audit.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="audit-empty">
              No entries yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Actor</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Target</th>
                    <th className="px-4 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody data-testid="audit-table">
                  {audit.data.data.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                      <td className="px-4 py-2">
                        {entry.actorType}
                        {entry.actorId ? (
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {entry.actorId}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden px-4 py-2 font-mono text-xs text-muted-foreground md:table-cell">
                        {entry.targetType}:{entry.targetId ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
