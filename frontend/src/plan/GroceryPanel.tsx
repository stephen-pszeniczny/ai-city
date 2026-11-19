// Mission Control's grocery list: an add box, the items as chips (tap to tick, × to
// take one off), and "Clear ticked" for everything bought. A name already on the
// list isn't added twice (the server returns the existing item).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import {
  addGrocery,
  clearTickedGrocery,
  getGrocery,
  removeGrocery,
  tickGrocery,
  type GroceryItem,
} from "../api";
import { itemCountLabel, tickedCount } from "./grocery";
import "./plan.css";

export function GroceryPanel() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: ["grocery"], queryFn: getGrocery });

  const done = () => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["grocery"] });
  };
  const onError = (err: Error) => setError(err.message);
  const add = useMutation({
    mutationFn: addGrocery,
    onSuccess: () => {
      setName("");
      input.current?.focus();
      done();
    },
    onError,
  });
  const tick = useMutation({
    mutationFn: (item: GroceryItem) => tickGrocery(item.id, !item.ticked),
    onSuccess: done,
    onError,
  });
  const remove = useMutation({ mutationFn: removeGrocery, onSuccess: done, onError });
  const clear = useMutation({ mutationFn: clearTickedGrocery, onSuccess: done, onError });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  }

  if (list.isPending) return <p className="plan__note">Loading…</p>;
  if (list.isError)
    return (
      <p className="form-error" role="alert">
        {list.error.message}
      </p>
    );
  const ticked = tickedCount(list.data);

  return (
    <div className="plan grocery">
      <form className="plan__form" onSubmit={submit}>
        <input
          ref={input}
          className="field grocery__input"
          aria-label="Add item"
          placeholder="Add item"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={add.isPending || !name.trim()}>
          Add
        </button>
        <span className="plan__tag">{itemCountLabel(list.data.open)}</span>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <ul className="grocery__items" aria-label="Grocery list">
        {list.data.items.map((item) => (
          <li key={item.id} className={`grocery__chip${item.ticked ? " is-on" : ""}`}>
            <button
              type="button"
              className="grocery__name"
              aria-pressed={item.ticked}
              disabled={tick.isPending}
              onClick={() => tick.mutate(item)}
            >
              {item.ticked ? "✓ " : ""}
              {item.name}
            </button>
            <button
              type="button"
              className="grocery__remove"
              aria-label={`Take ${item.name} off the list`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {ticked > 0 && (
        <button
          type="button"
          className="btn btn--quiet grocery__clear"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
        >
          Clear ticked ({ticked})
        </button>
      )}
    </div>
  );
}
