"use client";
import { useState } from "react";
import { useRevalidator } from "react-router";

import { client } from "~/app/_lib/client";

/** A client component: posts through the typed API client, then refreshes the server data. */
export default function Form() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useRevalidator();

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const [, err] = await client("/api/todos", {
          method: "POST",
          body: { title },
        });

        if (err) {
          setError(err.message);
          return;
        }

        setError(null);
        setTitle("");
        await revalidate();
      }}
    >
      <input
        aria-label="New todo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button disabled={!title}>Add</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
