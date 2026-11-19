import { PackageX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <EmptyState
      icon={PackageX}
      title="Product not found"
      description="It may have been entered incorrectly. Products are never deleted, so check the archived list."
      action={
        <Button asChild>
          <Link href="/products?filter=all">All products</Link>
        </Button>
      }
      className="mt-10"
    />
  );
}
