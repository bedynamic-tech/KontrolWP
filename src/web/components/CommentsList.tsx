import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { CommentAction, PendingComment } from "../../shared/types";
import { moderateComment } from "../api";
import { timeAgo } from "../format";
import { EmptyRow } from "./Section";

export function CommentsList(props: { comments: PendingComment[]; showSite: boolean }) {
  if (!props.comments.length) return <EmptyRow>No comments are waiting for review.</EmptyRow>;
  return (
    <ul className="divide-y">
      {props.comments.map((comment) => (
        <CommentRow key={`${comment.site_id}:${comment.comment_id}`} comment={comment} showSite={props.showSite} />
      ))}
    </ul>
  );
}

function CommentRow(props: { comment: PendingComment; showSite: boolean }) {
  const { comment } = props;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (action: CommentAction) => moderateComment(comment.site_id, comment.comment_id, action),
    onMutate: () => setError(null),
    onError: (err: Error) => setError(err.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site", comment.site_id] });
    },
  });
  const busy = mutation.isPending;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="text-sm font-medium text-foreground">{comment.author || "Anonymous"}</span>
        {comment.author_email && <span>{comment.author_email}</span>}
        <span>{timeAgo(comment.created_at)}</span>
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm">{comment.content}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {props.showSite && (
          <>
            <Link to={`/sites/${comment.site_id}`} className="hover:text-foreground hover:underline">
              {comment.site_name}
            </Link>
            {" · "}
          </>
        )}
        On{" "}
        <a href={comment.post_url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
          {comment.post_title || "Untitled"}
        </a>
      </p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="xs" onClick={() => mutation.mutate("approve")} disabled={busy} loading={busy && mutation.variables === "approve"}>
          Approve
        </Button>
        <Button size="xs" variant="outline" onClick={() => mutation.mutate("spam")} disabled={busy} loading={busy && mutation.variables === "spam"}>
          Spam
        </Button>
        <Button size="xs" variant="ghost" onClick={() => mutation.mutate("trash")} disabled={busy} loading={busy && mutation.variables === "trash"}>
          Trash
        </Button>
      </div>
    </li>
  );
}
