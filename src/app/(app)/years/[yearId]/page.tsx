import { redirect } from "next/navigation";

export default async function YearIndex({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params;
  redirect(`/years/${yearId}/dashboard`);
}
