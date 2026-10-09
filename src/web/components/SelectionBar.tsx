import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A checkbox that can show "some selected". */
export function SelectBox(props: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current)
      ref.current.indeterminate = !!props.indeterminate && !props.checked;
  }, [props.indeterminate, props.checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={props.className ?? "size-4 shrink-0 accent-primary"}
      checked={props.checked}
      onChange={props.onChange}
      aria-label={props.label}
      disabled={props.disabled}
    />
  );
}

/**
 * The header row of a list whose rows can be checked. Checkboxes stay hidden
 * until Select is pressed; then Select all and the count sit on the left and
 * the actions on the right, until Cancel or Esc.
 */
export function SelectionBar(props: {
  selecting: boolean;
  onSelect: () => void;
  onCancel: () => void;
  /** An action is running: nothing can be changed and Esc does nothing. */
  busy?: boolean;
  allChecked: boolean;
  someChecked: boolean;
  canSelectAll: boolean;
  onToggleAll: () => void;
  /** The Select all checkbox's label, such as "Check every plugin". */
  selectAllLabel: string;
  /** Left of the bar while selecting, after Select all: the count or progress. */
  status?: ReactNode;
  /** Right of the bar while selecting, before Cancel. */
  actions?: ReactNode;
  /** Left of the bar while not selecting. */
  start?: ReactNode;
  /** Right of the bar while not selecting, before Select. */
  tools?: ReactNode;
  /** Rows under the bar's own, such as progress or errors. */
  children?: ReactNode;
  className?: string;
}) {
  const { selecting, busy, onCancel } = props;

  // Esc leaves selection, unless a dialog or menu is open to take it.
  useEffect(() => {
    if (!selecting || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, busy, onCancel]);

  return (
    <div className={props.className ?? "border-b bg-muted/40 px-4 py-2"}>
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {!selecting && props.start}
        {selecting && (
          <div className="mr-auto flex min-h-8 w-full min-w-0 items-center gap-3 sm:w-auto">
            {props.canSelectAll && (
              <SelectBox
                checked={props.allChecked}
                indeterminate={props.someChecked}
                onChange={props.onToggleAll}
                label={props.selectAllLabel}
                disabled={busy}
              />
            )}
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              {props.status}
            </span>
            {/* On phones the actions wrap below, so Cancel stays up here by the count. */}
            <Button size="sm" variant="ghost" className="sm:hidden" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {selecting ? (
            <>
              {props.actions}
              <Button size="sm" variant="ghost" className="max-sm:hidden" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {props.tools}
              {props.canSelectAll && (
                <Button size="sm" variant="outline" onClick={props.onSelect}>
                  Select
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {props.children}
    </div>
  );
}
