import { useLocals } from "express/rsc/context";
import { Link } from "react-router";

import Form from "~/app/_components/form";
import tododb from "~/models/todo";

/** A server component: a typed Kysely query, rendered on the server. */
export default async function Home() {
  const { db } = useLocals();
  const list = await tododb.findAll(db);

  return (
    <>
      <h1>Todos</h1>
      <ul>
        {list.map((todo) => (
          <li key={todo.id}>
            <Link to={`/todos/${todo.id}`}>{todo.title}</Link>
            {todo.done ? " ✓" : ""}
          </li>
        ))}
      </ul>
      <Form />
    </>
  );
}
