import { getPublicStatus } from "@/lib/ai/config";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Workspace status={getPublicStatus()} />;
}