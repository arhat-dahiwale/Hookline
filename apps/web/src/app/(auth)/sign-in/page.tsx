'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: authError } = await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (authError) {
      setError(
        authError.status === 401 ? 'Invalid email or password.' : 'Sign-in failed. Try again.',
      );
      return;
    }
    router.push('/overview');
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in to Hookline</CardTitle>
        <CardDescription>Enter your credentials to access your dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="sign-in-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
            data-testid="sign-in-submit"
          >
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link href="/sign-up" className="underline underline-offset-4 hover:text-foreground">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
