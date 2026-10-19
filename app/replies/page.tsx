import { redirect } from "next/navigation";

export default function RepliesPage() {
  redirect("/inbox?filter=all");
}
