import { CodeError } from "@opentyped/framestack-error";
import type { RequestHandler } from "express";

import type { Todo, TodoId } from "~/models/todo";
import tododb from "~/models/todo";

/** Read the id route parameter as the database's branded id. */
const idOf = (id: string) => Number(id) as TodoId;

/** Read one todo. */
export const GET: RequestHandler<{ id: string }, Todo> = async (req, res) => {
  const todo = await tododb.findById(res.locals.db, idOf(req.params.id));

  if (!todo) {
    throw CodeError.notfound("todo");
  }

  res.json(todo);
};

GET.openapi = {
  operationId: "getTodo",
  tags: ["Todos"],
  responses: {
    "200": { description: "The todo" },
    "404": { description: "No todo with this id" },
  },
};

/** Mark a todo done or open. */
export const PATCH: RequestHandler<
  { id: string },
  Todo,
  { done: boolean }
> = async (req, res) => {
  const todo = await tododb.update(res.locals.db, idOf(req.params.id), {
    done: req.body.done ? 1 : 0,
  });

  if (!todo) {
    throw CodeError.notfound("todo");
  }

  res.json(todo);
};

PATCH.openapi = {
  operationId: "updateTodo",
  tags: ["Todos"],
  responses: {
    "200": { description: "The updated todo" },
    "404": { description: "No todo with this id" },
  },
};

/** Delete one todo. */
export const DELETE: RequestHandler<{ id: string }> = async (req, res) => {
  res.sendStatus(
    (await tododb.remove(res.locals.db, idOf(req.params.id))) ? 204 : 404,
  );
};
