import type { RequestHandler } from "express";

import type { Todo } from "~/models/todo";
import tododb from "~/models/todo";

/** List all todos. */
export const GET: RequestHandler<Record<string, never>, Todo[]> = async (
  _req,
  res,
) => {
  res.json(await tododb.findAll(res.locals.db));
};

GET.openapi = {
  operationId: "listTodos",
  tags: ["Todos"],
  responses: { "200": { description: "All todos" } },
};

/** Create a todo from a JSON body. */
export const POST: RequestHandler<
  Record<string, never>,
  Todo,
  { title: string }
> = async (req, res) => {
  const todo = await tododb.insert(res.locals.db, { title: req.body.title });

  res.locals.log.info({ todoId: todo.id }, "todo created");
  res.json(todo);
};

POST.openapi = {
  operationId: "createTodo",
  tags: ["Todos"],
  responses: { "200": { description: "The created todo" } },
};
