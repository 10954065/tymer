import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { getCurrentSession } from "@/server/auth/current-user";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session ? homePathFor(session.user.role) : "/login");
}
