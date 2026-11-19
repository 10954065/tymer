import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { getCurrentSession } from "@/server/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getCurrentSession();
  if (session) redirect(homePathFor(session.user.role));
  const { next } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <aside className="texture-grain relative hidden overflow-hidden bg-[oklch(0.3_0.06_163)] p-12 text-[oklch(0.96_0.02_160)] lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-[oklch(0.42_0.09_163)] opacity-60 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-20 size-[22rem] rounded-full bg-[oklch(0.72_0.12_80)] opacity-20 blur-3xl" />
        <p className="relative text-xs font-semibold tracking-[0.2em] uppercase opacity-70">Point of sale · Inventory · Finance</p>
        <div className="relative max-w-md">
          <h1 className="font-heading text-5xl leading-[1.05] font-semibold">
            SmartLiving
            <span className="block text-[oklch(0.82_0.1_85)] italic">Buynfry Ventures</span>
          </h1>
          <p className="mt-6 text-base leading-relaxed opacity-80">
            Every sale, order, cedi and item of décor — accounted for, from the counter to the books.
          </p>
        </div>
        <p className="relative text-xs opacity-60">Accra, Ghana · Amounts in GH₵</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="font-heading text-3xl font-semibold">SmartLiving</p>
            <p className="text-sm text-muted-foreground">Buynfry Ventures</p>
          </div>
          <h2 className="font-heading text-2xl font-semibold">Welcome back</h2>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">Sign in with the account your manager gave you.</p>
          <LoginForm nextPath={nextPath} />
        </div>
      </main>
    </div>
  );
}
