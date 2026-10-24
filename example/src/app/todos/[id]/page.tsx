import type { Request, Response } from "express";
import type { MetadataFunction, PageProps } from "express/rsc";

import type { TodoId } from "~/models/todo";
import tododb from "~/models/todo";

/** Load one todo; an unknown id answers 404. */
export async function loader(req: Request<{ id: string }>, res: Response) {
  const todo = await tododb.findById(
    res.locals.db,
    Number(req.params.id) as TodoId,
  );

  if (!todo) {
    res.status(404);
  }

  return todo ?? null;
}

export const metadata: MetadataFunction<typeof loader> = ({ loaderData }) => ({
  title: loaderData?.title ?? "Not found",
});

/** Render the loaded todo. */
export default function TodoPage({
  loaderData: todo,
}: PageProps<typeof loader>) {
  if (!todo) {
    return <p>No such todo.</p>;
  }

  return (
    <>
      <h1>{todo.title}</h1>
      <p>{todo.done ? "Done" : "Open"}</p>
    </>
  );
}
