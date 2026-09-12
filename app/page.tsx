import { redirect } from "next/navigation";

/**
 * The root path has no content of its own: signed-in users belong on the
 * dashboard, and middleware sends anonymous users to sign in.
 */
export default function RootPage() {
  redirect("/dashboard");
}
