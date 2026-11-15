// "Archived “X”. Undo" banner shown for a few seconds after archiving.
//
// Undo puts the task back how it was. The backend has no un-archive, so a
// task that was done is reopened and then completed again (both show in its
// history). Even after the banner goes, the task stays under Archived and can
// be restored from its detail view.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { completeTask, reopenTask, type Task, type TaskStatus } from "../api";

export const UNDO_SECONDS = 6;

export type Archived = { task: Task; previous: TaskStatus };

export function UndoToast({ archived, onDone }: { archived: Archived; onDone: () => void }) {
  const queryClient = useQueryClient();

  const undo = useMutation({
    mutationFn: async () => {
      await reopenTask(archived.task.id);
      if (archived.previous === "done") await completeTask(archived.task.id);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["history", archived.task.id] });
    },
    onSuccess: onDone,
  });

  // Goes away on its own unless an undo is running or has failed (the error stays readable).
  useEffect(() => {
    if (undo.isPending || undo.isError) return;
    const timer = window.setTimeout(onDone, UNDO_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [undo.isPending, undo.isError, onDone]);

  return (
    <div className="toast" role="status">
      {undo.isError ? (
        <span className="toast__error">Couldn't undo: {undo.error.message}</span>
      ) : (
        <span className="toast__text">Archived “{archived.task.title}”</span>
      )}
      {undo.isError ? (
        <button type="button" className="toast__btn" onClick={onDone}>
          Close
        </button>
      ) : (
        <button
          type="button"
          className="toast__btn"
          disabled={undo.isPending}
          onClick={() => undo.mutate()}
        >
          {undo.isPending ? "Undoing…" : "Undo"}
        </button>
      )}
    </div>
  );
}
