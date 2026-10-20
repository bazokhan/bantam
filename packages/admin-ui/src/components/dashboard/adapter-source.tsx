import { useQuery } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";

import { AdminApiError, api } from "@/lib/api";
import { bytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "./primitives";

export function AdapterSourceDialog({
  adapterId,
  onOpenChange,
}: {
  adapterId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const source = useQuery({
    queryKey: ["admin-adapter-source", adapterId],
    queryFn: () => {
      if (!adapterId) throw new Error("No adapter selected");
      return api.adapterSource(adapterId);
    },
    enabled: adapterId !== null,
    retry: false,
  });

  const error = source.error instanceof AdminApiError ? source.error : null;

  return (
    <Dialog open={adapterId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{adapterId ? `Source — ${adapterId}` : "Adapter source"}</DialogTitle>
          <DialogDescription>
            Read-only. Adapters are written and versioned in their own sibling repository, the
            server imports the compiled module at boot and there is no hot reload — a change ships
            with a new deployment and a restart. This console shows which file is running; it never
            writes to it.
          </DialogDescription>
        </DialogHeader>

        {source.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : error ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              {error.status === 404
                ? "This adapter has no source file on disk."
                : "Could not load the adapter source."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          </div>
        ) : source.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
              <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={source.data.file}>
                {source.data.file}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {bytes(source.data.bytes)}
              </span>
              <CopyButton value={source.data.content} label="Copy source" />
            </div>
            <pre className="max-h-[60vh] w-full overflow-auto border border-border bg-code p-4 font-mono text-xs leading-6 text-code-foreground">
              <code>{source.data.content}</code>
            </pre>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
