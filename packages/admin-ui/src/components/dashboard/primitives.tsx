import { useMemo, useState, type ReactNode } from "react";
import { Check, Clipboard, Code2, Expand, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Console</span>
          <span>/</span>
          <span className="truncate">{breadcrumb ?? title}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

type Tone = "success" | "danger" | "warning" | "neutral";

function toneFor(value: string): Tone {
  const v = value.toLowerCase();
  if (v.includes("active") || v.includes("verified") || v.includes("connected")) return "success";
  if (v.includes("published")) return "success";
  if (v.includes("fail") || v.includes("banned") || v.includes("missing")) return "danger";
  if (v.includes("attention") || v.includes("scheduled") || v.includes("production"))
    return "warning";
  return "neutral";
}

export function StatusBadge({ value, tone }: { value: string; tone?: Tone }) {
  const kind = tone ?? toneFor(value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        kind === "success" && "border-success/25 bg-success/10 text-success",
        kind === "danger" && "border-destructive/25 bg-destructive/10 text-destructive",
        kind === "warning" && "border-warning/25 bg-warning/10 text-warning",
        kind === "neutral" && "border-border bg-muted text-muted-foreground",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="border-r border-border px-5 py-4 last:border-r-0">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {icon ? <span className="text-foreground/70">{icon}</span> : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="font-mono text-2xl font-semibold text-foreground">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <section className="grid overflow-hidden border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-border bg-card", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const area = document.createElement("textarea");
          area.value = value;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        setDone(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check /> : <Clipboard />}
      {done ? "Copied" : label}
    </Button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}

export function DataToolbar({
  search,
  setSearch,
  placeholder,
  children,
}: {
  search: string;
  setSearch: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <SearchInput value={search} onChange={setSearch} placeholder={placeholder} />
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="w-full min-w-0 max-w-full overflow-x-auto border border-border bg-code p-4 font-mono text-xs leading-6 text-code-foreground">
      <code>{children}</code>
    </pre>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function JsonEditor({
  value,
  onSave,
  title = "JSON document",
  readonly = false,
}: {
  value: Record<string, unknown>;
  onSave?: (value: Record<string, unknown>) => Promise<void> | void;
  title?: string;
  readonly?: boolean;
}) {
  const initial = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [text, setText] = useState(initial);
  const [seed, setSeed] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Re-sync when the server document changes, without an effect.
  if (initial !== seed) {
    setSeed(initial);
    setText(initial);
  }
  const dirty = text !== initial;

  const save = async () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError("Expected a JSON object");
        return;
      }
      setError("");
      setSaving(true);
      await onSave?.(parsed as Record<string, unknown>);
      toast.success("JSON saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid JSON");
    } finally {
      setSaving(false);
    }
  };

  const editor = (
    <div className="overflow-hidden border border-border bg-code">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Code2 className="size-4" />
          <span>{title}</span>
          {dirty ? <Badge variant="outline">Unsaved</Badge> : null}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              try {
                setText(JSON.stringify(JSON.parse(text), null, 2));
                setError("");
              } catch {
                setError("Cannot format invalid JSON");
              }
            }}
          >
            Format
          </Button>
          <CopyButton value={text} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open focused editor"
            onClick={() => setExpanded(true)}
          >
            <Expand />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[3rem_1fr]">
        <div className="select-none border-r border-border py-3 text-right font-mono text-xs leading-6 text-muted-foreground">
          {text.split("\n").map((_, index) => (
            <div key={index} className="pr-3">
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          readOnly={readonly}
          spellCheck={false}
          aria-label={`${title} editor`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[320px] w-full resize-y bg-code p-3 font-mono text-xs leading-6 text-code-foreground outline-none"
        />
      </div>
      {error ? (
        <div className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</div>
      ) : null}
      {onSave && !readonly ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="outline" size="sm" onClick={() => setText(initial)} disabled={!dirty}>
            <X />
            Revert
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {editor}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[92vw]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Full-screen JSON editing.</DialogDescription>
          </DialogHeader>
          <textarea
            aria-label={`${title} full screen`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-[68vh] w-full resize-none bg-code p-4 font-mono text-sm leading-6 text-code-foreground outline-none"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SimpleSelect({
  value,
  onValueChange,
  items,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
