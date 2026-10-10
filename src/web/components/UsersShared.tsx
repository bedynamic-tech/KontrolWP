import { useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { NewUser, UserAction, UserRole } from "../../shared/types";
import { type BulkProgress } from "./PluginBulkBar";
import { SelectionBar } from "./SelectionBar";
import { Checkbox } from "@/components/ui/checkbox";

/** Role slugs as their names, such as "Administrator, Editor", or "No role". */
export function roleLabel(slugs: string[], roles: UserRole[]): string {
  if (!slugs.length) return "No role";
  const names = new Map(roles.map((role) => [role.slug, role.name]));
  return slugs.map((slug) => names.get(slug) ?? slug).join(", ");
}

const PENDING_LABELS: Record<UserAction, string> = {
  "set-role": "Changing roles...",
  "reset-password": "Sending password resets...",
  delete: "Deleting...",
};

/**
 * The actions for the checked users, at the top of a user list: change
 * their role, send each a password reset, or delete them. Checkboxes show
 * only after Select.
 */
export function UserBulkBar(props: {
  selecting: boolean;
  onSelect: () => void;
  onCancel: () => void;
  /** "3 users checked", or null when nothing is checked. */
  selection: string | null;
  count: number;
  roles: UserRole[];
  allChecked: boolean;
  someChecked: boolean;
  canSelectAll: boolean;
  onToggleAll: () => void;
  onRun: (action: UserAction, role?: string) => void;
  pending: UserAction | null;
  progress?: BulkProgress | null;
  deleteTitle: string;
  error?: string | null;
}) {
  const { pending, progress, count } = props;
  const busy = pending !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (pending === null) setConfirmDelete(false);
  }, [pending]);

  return (
    <SelectionBar
      selecting={props.selecting}
      onSelect={props.onSelect}
      onCancel={props.onCancel}
      busy={busy}
      allChecked={props.allChecked}
      someChecked={props.someChecked}
      canSelectAll={props.canSelectAll}
      onToggleAll={props.onToggleAll}
      selectAllLabel="Check every user"
      status={
        busy ? (
          <>
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            {PENDING_LABELS[pending]}
            {progress && progress.total > 1 && ` ${progress.done} of ${progress.total} done`}
          </>
        ) : (
          props.selection ?? "Nothing checked"
        )
      }
      actions={
        props.selection && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy} loading={pending === "set-role"}>
                  Change role ({count}) <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Change role to</p>
                {props.roles.map((role) => (
                  <DropdownMenuItem key={role.slug} onSelect={() => props.onRun("set-role", role.slug)}>
                    {role.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              loading={pending === "reset-password"}
              onClick={() => props.onRun("reset-password")}
            >
              Send password reset ({count})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              loading={pending === "delete"}
              onClick={() => setConfirmDelete(true)}
            >
              Delete ({count})
            </Button>
          </>
        )
      }
    >
      {busy && progress && progress.total > 1 && (
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label="Progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}
      {props.error && <p className="mt-1 whitespace-pre-line text-xs text-destructive">{props.error}</p>}

      <Dialog open={confirmDelete} onOpenChange={(open) => !busy && setConfirmDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.deleteTitle}</DialogTitle>
            <DialogDescription>
              WordPress deletes each account and gives their posts and pages to the site's earliest other administrator.
              A site's only administrator is never deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => props.onRun("delete")} loading={pending === "delete"}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SelectionBar>
  );
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Add a user: username, email, name, role and an optional password. The
 * fleet page adds a site picker as children; create throws to keep the
 * dialog open with its message.
 */
export function AddUserDialog(props: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: UserRole[];
  create: (user: NewUser) => Promise<unknown>;
  onSettled: () => void;
  canSubmit?: boolean;
  children?: ReactNode;
}) {
  const blank = { login: "", email: "", first_name: "", last_name: "", password: "" };
  const [fields, setFields] = useState(blank);
  const [role, setRole] = useState("subscriber");
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = props.roles.length ? props.roles : [{ slug: "subscriber", name: "Subscriber" }];

  const close = (open: boolean) => {
    if (pending) return;
    props.onOpenChange(open);
    if (!open) {
      setFields(blank);
      setRole("subscriber");
      setNotify(true);
      setError(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await props.create({
        login: fields.login.trim(),
        email: fields.email.trim(),
        role,
        first_name: fields.first_name.trim() || undefined,
        last_name: fields.last_name.trim() || undefined,
        password: fields.password || undefined,
        notify,
      });
      setPending(false);
      close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    } finally {
      props.onSettled();
    }
  };

  const field = (name: keyof typeof blank, label: string, extra: Partial<ComponentProps<typeof Input>> = {}) => (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input value={fields[name]} onChange={(e) => setFields({ ...fields, [name]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>Adds a WordPress account, as Users, Add New does in wp-admin.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("login", "Username", { required: true, autoComplete: "off", spellCheck: false })}
            {field("email", "Email", { required: true, type: "email", autoComplete: "off" })}
            {field("first_name", "First name", { autoComplete: "off" })}
            {field("last_name", "Last name", { autoComplete: "off" })}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={SELECT_CLASS}>
                {roles.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            {field("password", "Password", {
              type: "password",
              autoComplete: "new-password",
              placeholder: "Leave empty to let them set one",
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email them a link to set their password
          </label>
          {props.children}
          {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.canSubmit === false} loading={pending}>
              {pending ? "Adding..." : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
