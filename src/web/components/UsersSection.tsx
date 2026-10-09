import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compareVersions, USER_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { SiteSummary, SiteUser, UserAction, UserRole } from "../../shared/types";
import { createUser, fetchUsers, manageUser } from "../api";
import { plural } from "../format";
import { type BulkProgress } from "./PluginBulkBar";
import { SelectBox } from "./SelectionBar";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { AddUserDialog, roleLabel, UserBulkBar } from "./UsersShared";

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, USER_MANAGEMENT_SINCE) >= 0;
}

/** The site's users, read live from the site. */
export function UsersSection(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const users = useQuery({
    queryKey: ["site", site.id, "users"],
    queryFn: () => fetchUsers(site.id),
    enabled: supported(site),
    refetchInterval: false,
  });

  let body;
  if (!supported(site)) {
    body = (
      <EmptyRow>
        Managing users needs KontrolWP Connect {USER_MANAGEMENT_SINCE} or later. This site runs {site.plugin_version}; it
        updates automatically.
      </EmptyRow>
    );
  } else if (users.isPending) {
    body = <EmptyRow>Loading users...</EmptyRow>;
  } else if (users.error) {
    body = <p className="px-4 py-6 text-center text-sm text-destructive">{users.error.message}</p>;
  } else {
    body = <SiteUserList site={site} users={users.data.users} roles={users.data.roles} />;
  }

  return (
    <Section
      title={users.data ? `Users (${users.data.total})` : "Users"}
      action={
        users.data && (
          <Button size="sm" variant="outline" aria-label="Add user" onClick={() => setAdding(true)}>
            <PlusIcon /> Add
          </Button>
        )
      }
    >
      {body}
      <AddUserDialog
        title={`Add a user to ${site.name}`}
        open={adding}
        onOpenChange={setAdding}
        roles={users.data?.roles ?? []}
        create={(user) => createUser(site.id, user)}
        onSettled={() => {
          queryClient.invalidateQueries({ queryKey: ["site", site.id, "users"] });
          queryClient.invalidateQueries({ queryKey: ["fleet-users"] });
        }}
      />
    </Section>
  );
}

type Result = { id: number; ok: boolean; error?: string };

function SiteUserList(props: { site: SiteSummary; users: SiteUser[]; roles: UserRole[] }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [working, setWorking] = useState<number | null>(null);

  const query = search.trim().toLowerCase();
  const shown = query
    ? props.users.filter((user) =>
        [user.login, user.email, user.display_name].some((value) => value.toLowerCase().includes(query)),
      )
    : props.users;
  const selected = props.users.filter((user) => checked.has(user.id));
  const allChecked = shown.length > 0 && shown.every((user) => checked.has(user.id));

  const action = useMutation({
    mutationFn: async ({ action: next, role }: { action: UserAction; role?: string }): Promise<Result[]> => {
      const results: Result[] = [];
      setProgress({ done: 0, total: selected.length });
      // One at a time, as WordPress changes users one request after another.
      for (const user of selected) {
        setWorking(user.id);
        try {
          await manageUser(site.id, user.id, next, role);
          results.push({ id: user.id, ok: true });
        } catch (err) {
          results.push({ id: user.id, ok: false, error: (err as Error).message });
        }
        setProgress({ done: results.length, total: selected.length });
      }
      return results;
    },
    onMutate: () => setErrors(new Map()),
    onSuccess: (results) => {
      const failed = results.filter((result) => !result.ok);
      setErrors(new Map(failed.map((result) => [result.id, result.error ?? "Failed"])));
      setChecked(new Set(failed.map((result) => result.id)));
      if (!failed.length) setSelecting(false);
    },
    onSettled: () => {
      setWorking(null);
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "users"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-users"] });
    },
  });

  const stopSelecting = () => {
    setSelecting(false);
    setChecked(new Set());
    setErrors(new Map());
  };

  const toggle = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  return (
    <>
      {props.users.length > 8 && (
        <div className="relative border-b px-4 py-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users"
            aria-label="Search users"
            className="pl-8"
          />
        </div>
      )}
      <UserBulkBar
        selecting={selecting}
        onSelect={() => setSelecting(true)}
        onCancel={stopSelecting}
        selection={selected.length ? `${plural(selected.length, "user")} checked` : null}
        count={selected.length}
        roles={props.roles}
        allChecked={allChecked}
        someChecked={selected.length > 0}
        canSelectAll={shown.length > 0}
        onToggleAll={() => {
          const next = new Set(checked);
          for (const user of shown) allChecked ? next.delete(user.id) : next.add(user.id);
          setChecked(next);
        }}
        onRun={(next, role) => action.mutate({ action: next, role })}
        pending={action.isPending ? action.variables.action : null}
        progress={action.isPending ? progress : null}
        deleteTitle={selected.length === 1 ? `Delete ${selected[0].display_name || selected[0].login}?` : `Delete ${selected.length} users?`}
        error={
          action.error?.message ??
          (errors.size ? `${plural(errors.size, "change")} failed. Those users stay checked.` : null)
        }
      />
      {!shown.length ? (
        <EmptyRow>{query ? `No users match "${search.trim()}".` : "No users."}</EmptyRow>
      ) : (
        <ul className="divide-y">
          {shown.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              roles={props.roles}
              magicLogin={site.login_user_id === user.id}
              selecting={selecting}
              checked={checked.has(user.id)}
              onToggle={() => toggle(user.id)}
              error={errors.get(user.id) ?? null}
              working={action.isPending && working === user.id}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function UserRow(props: {
  user: SiteUser;
  roles: UserRole[];
  magicLogin: boolean;
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
  error: string | null;
  working: boolean;
}) {
  const { user } = props;
  const name = user.display_name || user.login;
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:items-center">
      {props.selecting && (
        <span className="mt-2.5 flex size-4 shrink-0 items-center justify-center sm:mt-0">
          {props.working ? (
            <Spinner className="size-4 text-muted-foreground" label={`Changing ${name}`} />
          ) : (
            <SelectBox checked={props.checked} onChange={props.onToggle} label={`Check ${name}`} />
          )}
        </span>
      )}
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {name !== user.login && <span className="font-normal text-muted-foreground"> ({user.login})</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[user.email, roleLabel(user.roles, props.roles), props.magicLogin && "Magic Login"].filter(Boolean).join(" · ")}
        </p>
        {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
      </div>
    </li>
  );
}
