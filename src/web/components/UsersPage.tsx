import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { USER_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { FleetUser, FleetUsers, UserAction, UserRole } from "../../shared/types";
import { bulkUserAction, createUserOnSites, fetchFleetUsers, fetchOverview } from "../api";
import { plural } from "../format";
import { SelectBox, type BulkProgress } from "./PluginBulkBar";
import { EmptyRow, Section } from "./Section";
import { SitePicker } from "./SitePicker";
import { AddUserDialog, roleLabel, UserBulkBar } from "./UsersShared";

const QUERY_KEY = ["fleet-users"];

/** The same person across sites: matched by email, or by username without one. */
const personKey = (user: FleetUser) => (user.email || `login:${user.login}`).toLowerCase();
const keyOf = (user: FleetUser) => `${user.site_id}|${user.user_id}`;

function groupUsers(users: FleetUser[]): FleetUser[][] {
  const groups = new Map<string, FleetUser[]>();
  for (const user of users) groups.set(personKey(user), [...(groups.get(personKey(user)) ?? []), user]);
  return [...groups.values()].sort((a, b) =>
    (a[0].display_name || a[0].login).localeCompare(b[0].display_name || b[0].login),
  );
}

/** Users across every site, as of each site's last sync. */
export function UsersPage() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const { data, error, isPending } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchFleetUsers });

  const groups = useMemo(() => groupUsers(data?.users ?? []), [data]);
  const query = search.trim().toLowerCase();
  const shown = query
    ? groups.filter((group) =>
        group.some((user) => [user.login, user.email, user.display_name].some((value) => value.toLowerCase().includes(query))),
      )
    : groups;
  const siteCount = new Set(data?.users.map((user) => user.site_id)).size;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!data}>
          <PlusIcon /> Add user
        </Button>
      </div>

      {isPending ? (
        <div className="mt-8 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">{error.message}</p>
      ) : (
        <>
          {data.unsupported_sites.length > 0 && <UnsupportedNote sites={data.unsupported_sites} />}
          <div className="relative mt-6">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username or email"
              aria-label="Search users"
              className="pl-8"
            />
          </div>
          <Section title={`${plural(groups.length, "user")} across ${plural(siteCount, "site")}`}>
            {!groups.length ? (
              <EmptyRow>No users yet. Each site's users show here after it syncs.</EmptyRow>
            ) : !shown.length ? (
              <EmptyRow>No users match "{search.trim()}".</EmptyRow>
            ) : (
              <FleetUserList users={data.users} groups={shown} roles={data.roles} />
            )}
          </Section>
        </>
      )}

      {data && (
        <FleetAddUserDialog open={adding} onOpenChange={setAdding} roles={data.roles} unsupported={data.unsupported_sites} />
      )}
    </div>
  );
}

function UnsupportedNote(props: { sites: FleetUsers["unsupported_sites"] }) {
  const names = props.sites.map((site) => site.name);
  return (
    <p className="mt-6 rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
      {names.length === 1 ? `${names[0]} is` : `${names.length} sites are`} not listed here yet. Managing users needs
      KontrolWP Connect {USER_MANAGEMENT_SINCE} or later, which installs itself on the next sync.
      {names.length > 1 && <span className="mt-1 block text-xs">{names.join(", ")}</span>}
    </p>
  );
}

type Result = { key: string; ok: boolean; error?: string };

/** The fleet's users with checkboxes, and one action bar for everything checked. */
function FleetUserList(props: { users: FleetUser[]; groups: FleetUser[][]; roles: UserRole[] }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<BulkProgress | null>(null);

  const selected = props.users.filter((user) => checked.has(keyOf(user)));
  const visible = props.groups.flat();
  const allChecked = visible.length > 0 && visible.every((user) => checked.has(keyOf(user)));

  const toggle = (users: FleetUser[], on: boolean) => {
    const next = new Set(checked);
    for (const user of users) on ? next.add(keyOf(user)) : next.delete(keyOf(user));
    setChecked(next);
  };

  const action = useMutation({
    mutationFn: async ({ action: next, role }: { action: UserAction; role?: string }): Promise<Result[]> => {
      // One request per site, so progress counts up as each site finishes.
      const bySite = new Map<number, FleetUser[]>();
      for (const user of selected) bySite.set(user.site_id, [...(bySite.get(user.site_id) ?? []), user]);
      const results: Result[] = [];
      setProgress({ done: 0, total: selected.length });
      for (const [siteId, users] of bySite) {
        try {
          const { results: bySiteResults } = await bulkUserAction(
            next,
            users.map((user) => ({ site_id: siteId, user_id: user.user_id })),
            role,
          );
          for (const result of bySiteResults) {
            results.push({ key: `${result.site_id}|${result.user_id}`, ok: result.ok, error: result.error });
          }
        } catch (err) {
          for (const user of users) results.push({ key: keyOf(user), ok: false, error: (err as Error).message });
        }
        setProgress({ done: results.length, total: selected.length });
      }
      return results;
    },
    onMutate: () => setErrors(new Map()),
    onSuccess: (results) => {
      const failed = results.filter((result) => !result.ok);
      setErrors(new Map(failed.map((result) => [result.key, result.error ?? "Failed"])));
      setChecked(new Set(failed.map((result) => result.key)));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });

  const people = new Set(selected.map(personKey)).size;
  const sites = new Set(selected.map((user) => user.site_id)).size;

  return (
    <>
      <UserBulkBar
        selection={selected.length ? `${plural(people, "user")} on ${plural(sites, "site")} checked` : null}
        count={selected.length}
        roles={props.roles}
        allChecked={allChecked}
        someChecked={selected.length > 0}
        canSelectAll={visible.length > 0}
        onToggleAll={() => toggle(visible, !allChecked)}
        onRun={(next, role) => action.mutate({ action: next, role })}
        pending={action.isPending ? action.variables.action : null}
        progress={action.isPending ? progress : null}
        deleteTitle={`Delete ${plural(people, "user")} from ${plural(sites, "site")}?`}
        error={
          action.error?.message ??
          (errors.size ? `${plural(errors.size, "change")} failed. Those stay checked; see each site below.` : null)
        }
      />
      <ul className="divide-y">
        {props.groups.map((group) => (
          <UserGroup
            key={personKey(group[0])}
            users={group}
            roles={props.roles}
            checked={checked}
            errors={errors}
            onToggle={toggle}
          />
        ))}
      </ul>
    </>
  );
}

function UserGroup(props: {
  users: FleetUser[];
  roles: UserRole[];
  checked: Set<string>;
  errors: Map<string, string>;
  onToggle: (users: FleetUser[], on: boolean) => void;
}) {
  const { users, checked, errors } = props;
  const first = users[0];
  const name = first.display_name || first.login;
  const [open, setOpen] = useState(false);
  const expanded = open || users.some((user) => errors.has(keyOf(user)));
  const checkedCount = users.filter((user) => checked.has(keyOf(user))).length;
  const all = checkedCount === users.length;
  const roles = [...new Set(users.flatMap((user) => user.roles))];

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3 sm:items-center">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
          aria-hidden="true"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {name}
            {first.email && <span className="font-normal text-muted-foreground"> {first.email}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setOpen(!expanded)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
            >
              {plural(users.length, "site")}
              <ChevronDownIcon className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            </button>
            {` · ${roleLabel(roles, props.roles)}`}
            {checkedCount > 0 && !all && ` · ${checkedCount} of ${users.length} sites checked`}
          </p>
        </div>
        <SelectBox
          className="mt-1 size-4 shrink-0 accent-primary sm:mt-0"
          checked={all}
          indeterminate={checkedCount > 0}
          onChange={() => props.onToggle(users, !all)}
          label={`Check ${name} on every site`}
        />
      </div>
      {expanded && (
        <ul className="divide-y border-t bg-muted/30">
          {users.map((user) => (
            <li key={keyOf(user)} className="flex items-start gap-3 py-2.5 pr-4 pl-4 sm:pl-16">
              <div className="min-w-0 flex-1">
                <Link to={`/sites/${user.site_id}`} className="truncate text-sm hover:underline">
                  {user.site_name}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[user.login, roleLabel(user.roles, props.roles), user.magic_login && "Magic Login"].filter(Boolean).join(" · ")}
                </p>
                {errors.get(keyOf(user)) && <p className="mt-1 text-xs text-destructive">{errors.get(keyOf(user))}</p>}
              </div>
              <SelectBox
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={checked.has(keyOf(user))}
                onChange={() => props.onToggle([user], !checked.has(keyOf(user)))}
                label={`Check ${name} on ${user.site_name}`}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Add the same user to the sites chosen here. */
function FleetAddUserDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: UserRole[];
  unsupported: FleetUsers["unsupported_sites"];
}) {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, enabled: props.open });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const unsupported = new Set(props.unsupported.map((site) => site.id));
  const sites = (overview.data?.sites ?? []).filter((site) => !unsupported.has(site.id));
  const names = new Map<number, string>(sites.map((site) => [site.id, site.name]));
  const chosen = sites.filter((site) => selected.has(site.id)).map((site) => site.id);

  return (
    <AddUserDialog
      title="Add a user"
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) setSelected(new Set());
      }}
      roles={props.roles}
      canSubmit={chosen.length > 0}
      create={async (user) => {
        const { results } = await createUserOnSites(chosen, user);
        const failed = results.filter((result) => !result.ok);
        if (failed.length) {
          // Leave only the sites that failed chosen, so Add tries just those again.
          setSelected(new Set(failed.map((result) => result.site_id)));
          const done = results.length - failed.length;
          throw new Error(
            [
              ...(done ? [`Added on ${done} ${done === 1 ? "site" : "sites"}. These failed:`] : []),
              ...failed.map((result) => `${names.get(result.site_id) ?? `Site ${result.site_id}`}: ${result.error}`),
            ].join("\n"),
          );
        }
      }}
      onSettled={() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ["site"] });
      }}
    >
      <SitePicker
        sites={sites}
        loading={overview.isPending}
        selected={selected}
        onChange={setSelected}
        empty="No sites can manage users from KontrolWP yet."
      />
    </AddUserDialog>
  );
}
