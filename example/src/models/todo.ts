// import { query, raw, sql } from "@opentyped/framestack-kysely-db";
import type * as model from "odb";
import type * as row from "odb/kysely";
import type { Conn } from "odb/kysely";

import { tables } from "~/types/tables";

/** @schema */
export type TodoId = model.TodoId;

/** @schema */
export type Todo = model.Todo;

export type TodoTable = row.TodoTable;

export type NewTodo = row.NewTodo;

export type TodoUpdate = row.TodoUpdate;

/** Columns, keys, and constraints of todo. */
export const table = tables.todo;

// Created once by framestack; this file is yours.
export const tododb = {
  /** Every todo row. */
  async findAll(conn: Conn) {
    return conn.selectFrom("todo").selectAll().orderBy("id").execute();
  },

  async findById(conn: Conn, id: TodoId) {
    return conn
      .selectFrom("todo")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  },

  async insert(conn: Conn, todo: NewTodo) {
    return conn
      .insertInto("todo")
      .values(todo)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async update(conn: Conn, id: TodoId, changes: TodoUpdate) {
    return conn
      .updateTable("todo")
      .set(changes)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  },

  /** True when a row was deleted. */
  async remove(conn: Conn, id: TodoId) {
    const { numDeletedRows } = await conn
      .deleteFrom("todo")
      .where("id", "=", id)
      .executeTakeFirst();

    return numDeletedRows > 0n;
  },
};

export default tododb;
