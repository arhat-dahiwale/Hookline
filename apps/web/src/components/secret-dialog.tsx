'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * One-time secret reveal (API.md contract): the secret is shown once in this
 * dialog and is never re-fetchable from the server. Closing it is final.
 */
export function SecretDialog({
  title,
  description,
  secret,
  testId,
  onClose,
}: {
  title: string;
  description: string;
  secret: string;
  testId?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-3">
          <code
            className="block break-all font-mono text-sm"
            data-testid={testId ? `${testId}-secret` : undefined}
          >
            {secret}
          </code>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onClose} data-testid={testId ? `${testId}-done` : undefined}>
            I saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
